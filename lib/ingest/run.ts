import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import { extractCommitments } from "@/lib/agent/extract";
import { planCommitmentActions } from "@/lib/agent/action-plan";
import { generateFollowUpDraft } from "@/lib/agent/draft";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";
import { getServiceClient } from "@/lib/db/service";
import { contextForOrg } from "@/lib/google/draft-context";
import { gateCommitmentScope } from "@/lib/agent/scope-check";
import { detectEscalations } from "@/lib/agent/escalate";
import { detectExceptions } from "@/lib/ops/exceptions";
import { buildOperationsMap } from "@/lib/ops/map";
import { logFailure } from "@/lib/observability/log";
import type { AgentContract } from "@/lib/agent/contract";
import type { Commitment, Task } from "@/lib/types";

export interface IngestArgs {
  orgId: string; clientId: string; clientName: string;
  title: string; occurredAt: string; transcript: string;
}

export interface IngestResult {
  conversationId: string; transcriptId: string;
  commitmentCount: number; actionCount: number; draftCount: number;
  dropped: number; flagged: string[];
}

export async function runIngest(
  db: SupabaseClient, args: IngestArgs, model?: LanguageModel,
): Promise<IngestResult> {
  // The org's own blueprint decides, not a constant. An org that has never edited one
  // gets the shipped defaults. Kept, not discarded: finishIngest needs it again to decide
  // which escalation kinds this org asked to be shown.
  const contract = await contractFor(db, args.orgId);
  const decision = canExecute("draft_task_list", false, contract,
    { sources: ["transcript", "client_contact"] });
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);

  const { data: conversation, error: convError } = await db.from("conversation")
    .insert({ org_id: args.orgId, client_id: args.clientId, title: args.title,
      occurred_at: args.occurredAt }).select("id").single();
  if (convError) throw convError;

  // Persisted before the model runs: what was said survives a failed extraction.
  const { data: transcript, error: transcriptError } = await db.from("transcript")
    .insert({ org_id: args.orgId, conversation_id: conversation.id, body: args.transcript })
    .select("id").single();
  if (transcriptError) throw transcriptError;

  return finishIngest(db, {
    orgId: args.orgId, clientId: args.clientId, clientName: args.clientName,
    conversationId: conversation.id, transcriptId: transcript.id,
    transcript: args.transcript, occurredAt: args.occurredAt, contract,
  }, model);
}

export async function retryExtractionFor(
  db: SupabaseClient, transcriptId: string, model?: LanguageModel,
): Promise<IngestResult> {
  const { data: t, error } = await db.from("transcript")
    .select("id,org_id,conversation_id,body").eq("id", transcriptId).single();
  if (error || !t) throw new Error("transcript not found");

  // Checked after the lookup, because the org to check against comes from the transcript.
  const contract = await contractFor(db, t.org_id as string);
  const decision = canExecute("draft_task_list", false, contract,
    { sources: ["transcript", "client_contact"] });
  if (!decision.ok) throw new Error(`action denied: ${decision.reason}`);

  const { data: c } = await db.from("conversation")
    .select("id,client_id,occurred_at").eq("id", t.conversation_id).single();
  const { data: client } = await db.from("client_contact")
    .select("name").eq("id", c!.client_id).single();

  const { data: doomed } = await db.from("commitment").select("id")
    .eq("conversation_id", t.conversation_id).eq("status", "proposed");
  const doomedIds = (doomed ?? []).map((r) => r.id as string);
  if (doomedIds.length > 0) {
    const { error: draftDeleteError } = await db.from("deliverable_draft")
      .delete().in("commitment_id", doomedIds);
    if (draftDeleteError) throw draftDeleteError;
    const { error: commitmentDeleteError } = await db.from("commitment")
      .delete().in("id", doomedIds);
    if (commitmentDeleteError) throw commitmentDeleteError;
  }

  return finishIngest(db, {
    orgId: t.org_id, clientId: c!.client_id, clientName: client?.name ?? "client",
    conversationId: t.conversation_id, transcriptId: t.id,
    transcript: t.body, occurredAt: (c!.occurred_at as string).slice(0, 10), contract,
  }, model);
}

async function finishIngest(
  db: SupabaseClient,
  ctx: { orgId: string; clientId: string; clientName: string; conversationId: string;
    transcriptId: string; transcript: string; occurredAt: string; contract: AgentContract },
  model?: LanguageModel,
): Promise<IngestResult> {
  let extracted;
  try {
    extracted = await extractCommitments({
      transcript: ctx.transcript, conversationDate: ctx.occurredAt, clientName: ctx.clientName,
    }, model);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const { error: markError } = await db.from("transcript").update({
      extraction_status: "failed", extraction_error: message,
    }).eq("id", ctx.transcriptId);
    logFailure("finishIngest.markFailed", markError);
    throw e;
  }

  // Everything from here through the return is wrapped: extraction succeeded, but a
  // failure partway through commitment insertion, the transcript update, or escalation
  // writes must still leave the transcript discoverable as failed — not stuck `pending`
  // forever, invisible to `listFailedTranscripts` and with no Retry available.
  try {
    return await finishIngestAfterExtraction(db, ctx, extracted, model);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const { error: markError } = await db.from("transcript").update({
      extraction_status: "failed", extraction_error: message,
    }).eq("id", ctx.transcriptId);
    logFailure("finishIngest.markFailedAfterPartialWrite", markError);
    throw e;
  }
}

async function finishIngestAfterExtraction(
  db: SupabaseClient,
  ctx: { orgId: string; clientId: string; clientName: string; conversationId: string;
    transcriptId: string; transcript: string; occurredAt: string; contract: AgentContract },
  extracted: Awaited<ReturnType<typeof extractCommitments>>,
  model?: LanguageModel,
): Promise<IngestResult> {
  const flaggedSource = extracted.flagged.length > 0;

  // Inserted one at a time so each row pairs structurally with its source commitment —
  // a bulk INSERT ... RETURNING gives no order guarantee across multiple rows.
  const pairs: { id: string; commitment: (typeof extracted.commitments)[number] }[] = [];
  for (const c of extracted.commitments) {
    const { data, error } = await db.from("commitment").insert({
      org_id: ctx.orgId, conversation_id: ctx.conversationId, client_id: ctx.clientId,
      text: c.text, owner: c.owner, deadline: c.deadline, type: c.type,
      confidence: c.confidence, source_span: c.source_span,
      status: "proposed", source_flagged: flaggedSource,
    }).select("id").single();
    if (error) throw error;
    pairs.push({ id: data.id, commitment: c });
  }

  const capNote = extracted.dropped > 0
    ? `${extracted.dropped} commitments beyond the cap were dropped` : null;
  const { error: transcriptUpdateError } = await db.from("transcript").update({
    injection_flags: extracted.flagged,
    extraction_status: "ok",
    extraction_error: capNote,
  }).eq("id", ctx.transcriptId);
  if (transcriptUpdateError) throw transcriptUpdateError;

  // Raised before drafting: if the model call dies, the human still gets told that this
  // conversation contained a complaint or a promise nobody owns.
  const escalations = detectEscalations({
    transcript: ctx.transcript,
    commitments: extracted.commitments,
  });
  // The blueprint decides which conditions a human must be shown. The exception checks
  // below are a different thing — advisory statistics the blueprint has no column for and
  // never claimed to govern — so they are not filtered here.
  const governed = new Set(ctx.contract.escalationConditions);
  const raised = escalations.filter((x) => governed.has(x.kind));
  for (const e of raised) {
    const { error } = await db.from("escalation").insert({
      org_id: ctx.orgId, conversation_id: ctx.conversationId,
      commitment_id: e.commitmentIndex === null ? null : pairs[e.commitmentIndex]?.id ?? null,
      kind: e.kind, detail: e.detail,
    });
    // 23505: this conversation already has an open escalation of this kind. Re-running
    // ingest must not stack duplicates.
    if (error && error.code !== "23505") throw error;
  }
  // Exception checks: does this conversation look like how this business normally works?
  // Best-effort — a statistics failure must never cost an ingest.
  try {
    const [{ data: orgCommitments }, { data: orgTasks }, { data: clientHistory }] =
      await Promise.all([
        db.from("commitment").select("*").eq("org_id", ctx.orgId),
        db.from("task").select("*").eq("org_id", ctx.orgId),
        db.from("commitment").select("*").eq("org_id", ctx.orgId).eq("client_id", ctx.clientId),
      ]);

    const map = buildOperationsMap({
      commitments: (orgCommitments ?? []) as Commitment[],
      tasks: (orgTasks ?? []) as Task[],
      clientNames: {},
    }, new Date());

    const exceptions = detectExceptions({
      commitments: extracted.commitments,
      map,
      clientHistory: (clientHistory ?? []) as Commitment[],
    }, new Date());

    for (const x of exceptions) {
      const { error } = await db.from("escalation").insert({
        org_id: ctx.orgId, conversation_id: ctx.conversationId,
        commitment_id: x.commitmentIndex === null ? null : pairs[x.commitmentIndex]?.id ?? null,
        kind: x.kind, detail: x.detail, severity: x.severity,
      });
      if (error && error.code !== "23505") throw error;
    }
  } catch (e) {
    // Still deliberately swallowed: an unusual-practice check is advisory, and losing it
    // must not lose the commitments the conversation actually produced. But it is logged,
    // because a check that has been broken for a month should be discoverable.
    logFailure("finishIngest.exceptionChecks", e);
  }

  // The filtered list, not the raw one: an audit row saying this conversation was escalated
  // when the blueprint silenced every kind it found would be a lie.
  if (raised.length > 0) {
    await logAudit({
      orgId: ctx.orgId, actor: "agent", action: "create",
      target: `conversation:${ctx.conversationId}:escalate`,
    });
  }

  // Scope gate: fails open by construction — an org that never wrote a scope_of_work for
  // this client gets `skipped` on the very first query, so this is a no-op for every org
  // that hasn't opted in. A commitment the model flags as out-of-scope gets a change-order
  // draft instead of a normal follow-up (excluded from the drafts loop below), so the extra
  // ask isn't quietly treated as ordinary, already-agreed-to work.
  // Plan only after extraction has persisted the promise. Planning may suggest no actions;
  // it is never permission to perform an external action.
  const planned = await Promise.allSettled(pairs.map(async ({ id, commitment: c }) => {
    const plan = await planCommitmentActions({
      commitmentText: c.text,
      owner: c.owner,
      deadline: c.deadline,
      commitmentType: c.type,
      sourceSpan: c.source_span,
    }, model);

    if (plan.actions.length > 0) {
      const { error } = await db.from("commitment_action_suggestion").insert(
        plan.actions.map((action) => ({
          org_id: ctx.orgId,
          commitment_id: id,
          action_type: action.type,
          confidence: action.confidence,
          rationale: action.rationale,
          required_data: action.required_data,
          missing_data: action.missing_data,
        })),
      );
      if (error) throw error;
    }

    return { id, actions: plan.actions };
  }));

  const gmailDraftIds = new Set<string>();
  let actionCount = 0;
  for (const result of planned) {
    if (result.status === "rejected") {
      // Suggestions are secondary to preserving the extracted commitment. A model or
      // persistence failure is observable in logs but must not make ingest invent an email.
      logFailure("finishIngest.actionPlan", result.reason);
      continue;
    }
    actionCount += result.value.actions.length;
    if (result.value.actions.some((action) => action.type === "gmail_draft")) {
      gmailDraftIds.add(result.value.id);
    }
  }

  const scopeChecks = await Promise.allSettled(pairs.map(async ({ id, commitment: c }) => {
    const result = await gateCommitmentScope(db,
      { id, org_id: ctx.orgId, client_id: ctx.clientId, text: c.text }, {}, model);
    return { id, result };
  }));
  const outOfScopeIds = new Set<string>();
  for (const check of scopeChecks) {
    if (check.status === "rejected") { logFailure("finishIngest.scopeCheck", check.reason); continue; }
    if (check.value.result.outcome === "change_order_drafted") outOfScopeIds.add(check.value.id);
  }

  // Unattended ingest is not a human clicking approve — an org that set `draft_follow_up`
  // to ask-first or off must not get auto-generated drafts just because extraction ran.
  // Google context is optional: omit disallowed sources before fetching, so forbidding
  // templates or calendar events still permits a plain draft from the conversation.
  const contextSources = ["template", "calendar_event"]
    .filter((source) => ctx.contract.allowedSources.includes(source));
  const draftDecision = canExecute("draft_follow_up", false, ctx.contract,
    { sources: ["transcript", "client_contact", ...contextSources] });

  // Fetched once for the whole transcript, not per commitment: the template and the day's
  // meetings are the same for every promise made in one conversation. Empty for an org
  // that has connected nothing, which is every org until someone visits Settings.
  // `connected_data_source`'s token columns are service-role only — `contextForOrg` must
  // not be handed the session-scoped `db`, or every org's Google context resolves empty
  // regardless of connection state.
  const context = draftDecision.ok && gmailDraftIds.size > 0 && contextSources.length > 0
    ? await contextForOrg(getServiceClient(), {
      orgId: ctx.orgId, clientName: ctx.clientName, occurredAt: ctx.occurredAt,
      allowedSources: contextSources,
    })
    : { templateText: null, meetingContext: null, sources: [] as string[] };

  // A draft failing is not an ingest failing — that commitment keeps the empty-draft state.
  const drafts = draftDecision.ok
    ? await Promise.allSettled(pairs.filter(({ id }) =>
      gmailDraftIds.has(id) && !outOfScopeIds.has(id),
    ).map(async ({ id, commitment: c }) => {
      const draft = await generateFollowUpDraft({
        templateText: context.templateText, meetingContext: context.meetingContext,
        commitmentText: c.text, clientName: ctx.clientName,
        deadline: c.deadline, sourceSpan: c.source_span,
      }, model);
      const { error } = await db.from("deliverable_draft").insert({
        org_id: ctx.orgId, commitment_id: id, kind: "email",
        subject: draft.subject, body: draft.body,
      });
      if (error) throw error;
    }))
    : [];
  for (const d of drafts) {
    if (d.status === "rejected") logFailure("finishIngest.draft", d.reason);
  }
  const draftCount = drafts.filter((d) => d.status === "fulfilled").length;

  await logAudit({
    orgId: ctx.orgId, actor: "agent", action: "draft",
    target: `transcript:${ctx.transcriptId}:extract`,
  });

  return {
    conversationId: ctx.conversationId, transcriptId: ctx.transcriptId,
    commitmentCount: pairs.length, actionCount, draftCount,
    dropped: extracted.dropped, flagged: extracted.flagged,
  };
}
