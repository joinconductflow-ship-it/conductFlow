"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { executeAction } from "@/lib/agent/execute";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { pushDraftToGmail } from "@/lib/gmail/push";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import {
  getAccessToken,
  invalidateCachedToken,
  recordGoogleApiAuthFailure,
  DataSourceUnavailable,
} from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { createCalendarClient, calendarEventId } from "@/lib/google/calendar";
import { createDriveClient } from "@/lib/google/drive";
import { GoogleApiError } from "@/lib/google/api-error";
import { logAudit } from "@/lib/audit/log";
import { logFailure } from "@/lib/observability/log";
import {
  runApprovedActionSelection,
  selectPersistedSuggestions,
  type ActionExecutionResult,
  type ApprovedActionRunResult,
} from "@/lib/approvals/action-selection";
import {
  actionReadiness,
  calendarScheduleChanged,
  calendarTitle,
  sanitizeActionInput,
  sanitizeReviewerEditedFields,
  type ActionReadinessContext,
} from "@/lib/approvals/action-readiness";
import { inspectCalendarSchedule } from "@/lib/approvals/calendar-readiness";
import type {
  ActionExecutionState,
  Commitment,
  CommitmentActionSuggestion,
  DeliverableDraft,
  SuggestedActionType,
} from "@/lib/types";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];
const CALENDAR_SCOPE = CAPABILITIES.calendar_context.scopes[0];
const DRIVE_SCOPE = CAPABILITIES.drive_templates.scopes[0];
const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";
const EXECUTION_CLAIM_TTL_MS = 2 * 60_000;

class ReconnectGoogleError extends Error {
  constructor(message = "Reconnect Google to continue.") {
    super(message);
    this.name = "ReconnectGoogleError";
  }
}

async function currentUserId(): Promise<string> {
  const s = await getServerClient();
  const { data, error } = await s.auth.getUser();
  if (error || !data.user) throw new Error("Unable to verify session. Please sign in again.");
  return data.user.id;
}

function resultFor(
  suggestion: CommitmentActionSuggestion,
  state: ActionExecutionState,
  values: Partial<ActionExecutionResult> = {},
): ActionExecutionResult {
  return { id: suggestion.id, type: suggestion.action_type, state, ...values };
}

async function setActionState(
  db: SupabaseClient,
  suggestion: CommitmentActionSuggestion,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("commitment_action_suggestion")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", suggestion.id)
    .eq("org_id", suggestion.org_id);
  if (error) throw error;
}

async function claimAction(
  db: SupabaseClient,
  suggestion: CommitmentActionSuggestion,
): Promise<{ claimed: boolean; result?: ActionExecutionResult }> {
  const { data: fresh, error: fetchError } = await db.from("commitment_action_suggestion")
    .select("execution_state,external_id,external_url,last_error,executing_at")
    .eq("id", suggestion.id).eq("org_id", suggestion.org_id).single();
  if (fetchError) throw fetchError;
  if (fresh.external_id) {
    return { claimed: false, result: resultFor(suggestion, "created", {
      externalId: fresh.external_id as string,
      externalUrl: fresh.external_url as string | null,
    }) };
  }

  const state = (fresh.execution_state as ActionExecutionState | null) ?? "proposed";
  const executingAt = fresh.executing_at ? Date.parse(fresh.executing_at as string) : 0;
  const isFreshClaim = state === "executing" && Date.now() - executingAt < EXECUTION_CLAIM_TTL_MS;
  if (isFreshClaim) return { claimed: false, result: resultFor(suggestion, "executing") };

  const now = new Date().toISOString();
  const { data: claimed, error } = await db.from("commitment_action_suggestion")
    .update({ execution_state: "executing", executing_at: now, last_error: null, updated_at: now })
    .eq("id", suggestion.id)
    .eq("org_id", suggestion.org_id)
    .eq("execution_state", state)
    .is("external_id", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (claimed) return { claimed: true };

  const { data: winner, error: winnerError } = await db.from("commitment_action_suggestion")
    .select("execution_state,external_id,external_url,last_error")
    .eq("id", suggestion.id).eq("org_id", suggestion.org_id).single();
  if (winnerError) throw winnerError;
  return { claimed: false, result: resultFor(
    suggestion,
    winner.external_id ? "created" : (winner.execution_state as ActionExecutionState),
    {
      externalId: winner.external_id as string | null,
      externalUrl: winner.external_url as string | null,
      error: winner.last_error as string | null,
    },
  ) };
}

function executionFailureState(error: unknown): ActionExecutionState {
  if (error instanceof ReconnectGoogleError || error instanceof DataSourceUnavailable) {
    return "reconnect_google";
  }
  if (error instanceof GoogleApiError && error.reconnectRequired) return "reconnect_google";
  if (error instanceof GmailInvalidGrantError || error instanceof GmailUnauthorizedError) {
    return "reconnect_google";
  }
  return "failed";
}

async function executeClaimedAction(
  db: SupabaseClient,
  suggestion: CommitmentActionSuggestion,
  run: () => Promise<{ id: string; url?: string | null }>,
): Promise<ActionExecutionResult> {
  const claim = await claimAction(db, suggestion);
  if (!claim.claimed) return claim.result!;
  try {
    const external = await run();
    const now = new Date().toISOString();
    await setActionState(db, suggestion, {
      execution_state: "created",
      external_id: external.id,
      external_url: external.url ?? null,
      executed_at: now,
      executing_at: null,
      last_error: null,
    });
    return resultFor(suggestion, "created", {
      externalId: external.id,
      externalUrl: external.url ?? null,
    });
  } catch (error) {
    if (error instanceof GoogleApiError && error.reconnectRequired) {
      await recordGoogleApiAuthFailure(db, suggestion.org_id, error).catch((cleanupError) => {
        logFailure(`approveDetectedActions.${suggestion.action_type}.authCleanup`, cleanupError);
      });
    }
    const state = executionFailureState(error);
    const message = error instanceof Error ? error.message : "Action failed";
    await setActionState(db, suggestion, {
      execution_state: state,
      executing_at: null,
      last_error: message.slice(0, 500),
    });
    logFailure(`approveDetectedActions.${suggestion.action_type}`, error);
    return resultFor(suggestion, state, { error: message });
  }
}

async function googleToken(orgId: string, scope: string): Promise<string> {
  try {
    return await getAccessToken(getServiceClient(), orgId, scope);
  } catch (error) {
    if (error instanceof DataSourceUnavailable) throw new ReconnectGoogleError();
    throw error;
  }
}

function appendDocLink(body: string, url: string): string {
  if (body.includes(url)) return body;
  return `${body.trimEnd()}\n\nGoogle Doc: ${url}`;
}

interface AuthorizedContext {
  commitment: Commitment;
  draft: DeliverableDraft | null;
  clientName: string;
  suggestions: CommitmentActionSuggestion[];
}

async function loadAuthorizedContext(
  commitmentId: string,
): Promise<{ db: Awaited<ReturnType<typeof getServerClient>>; context: AuthorizedContext }> {
  const db = await getServerClient();
  const { data: commitment, error: commitmentError } = await db.from("commitment")
    .select("*").eq("id", commitmentId).single();
  if (commitmentError || !commitment) throw new Error("Commitment not found");
  const typed = commitment as Commitment;
  const [{ data: draft, error: draftError }, { data: client, error: clientError }, { data: suggestions, error: suggestionsError }] = await Promise.all([
    db.from("deliverable_draft").select("*").eq("commitment_id", commitmentId).limit(1).maybeSingle(),
    db.from("client_contact").select("name").eq("id", typed.client_id).eq("org_id", typed.org_id).maybeSingle(),
    db.from("commitment_action_suggestion").select("*")
      .eq("commitment_id", commitmentId).eq("org_id", typed.org_id)
      .in("confidence", ["high", "medium"]),
  ]);
  if (draftError) throw draftError;
  if (clientError) throw clientError;
  if (suggestionsError) throw suggestionsError;
  return {
    db,
    context: {
      commitment: typed,
      draft: (draft ?? null) as DeliverableDraft | null,
      clientName: (client?.name as string | undefined) ?? "Client",
      suggestions: (suggestions ?? []) as CommitmentActionSuggestion[],
    },
  };
}

export async function approveDetectedActions(
  commitmentId: string,
  selectedActionIds: string[],
  submittedInputs: Record<string, unknown> = {},
  reviewerEditedFields: Record<string, unknown> = {},
  clearedFields: Record<string, unknown> = {},
): Promise<ApprovedActionRunResult> {
  const uid = await currentUserId();
  const { db: sessionDb, context } = await loadAuthorizedContext(commitmentId);
  const selected = selectPersistedSuggestions(selectedActionIds, context.suggestions);
  const service = getServiceClient();
  const readinessContext: ActionReadinessContext = {
    commitment: context.commitment,
    clientName: context.clientName,
    draft: context.draft,
  };
  const prepared = new Map<string, CommitmentActionSuggestion>();
  let batchHasMissingInfo = false;

  for (const suggestion of selected) {
    const submitted = sanitizeActionInput(suggestion.action_type, submittedInputs[suggestion.id]);
    const reviewerFields = sanitizeReviewerEditedFields(reviewerEditedFields[suggestion.id]);
    const cleared = sanitizeReviewerEditedFields(clearedFields[suggestion.id]);
    let readiness = actionReadiness(suggestion, readinessContext, submitted, reviewerFields, cleared);
    let materialCalendarChange = false;
    if (suggestion.action_type === "calendar_event") {
      // Compare the EFFECTIVE schedule (after provenance + any source correction) with what
      // was persisted. Doing this after readiness is what stops a stale 18:00 -> source 16:00
      // correction from reusing conflict state computed for the old 18:00 schedule.
      materialCalendarChange = calendarScheduleChanged(suggestion.input_data ?? {}, readiness.data);
      if (materialCalendarChange) {
        const reviewSuggestion = { ...suggestion, preview_data: {}, input_data: {
          ...(suggestion.input_data ?? {}), conflict_confirmed: false,
        } };
        readiness = actionReadiness(reviewSuggestion, readinessContext, submitted, reviewerFields, cleared);
        // Empty preview drops schedule_conflict_confirmation from `missing`; forcing the flag
        // false guarantees a fresh conflict inspection runs before any event is created.
        readiness.data.conflict_confirmed = false;
      }
    }
    const state: ActionExecutionState = suggestion.external_id ? "created"
      : readiness.missing.includes("schedule_conflict_confirmation") ? "schedule_conflict"
        : readiness.ready ? "ready" : "needs_info";
    const updated = {
      ...suggestion,
      input_data: readiness.data,
      missing_data: readiness.missing,
      preview_data: materialCalendarChange ? {} : (suggestion.preview_data ?? {}),
      execution_state: state,
    };
    prepared.set(suggestion.id, updated);
    if (!suggestion.external_id) {
      await setActionState(service, suggestion, {
        input_data: readiness.data,
        missing_data: readiness.missing,
        preview_data: updated.preview_data,
        execution_state: state,
        last_error: null,
      });
    }
    if (!readiness.ready && !suggestion.external_id) batchHasMissingInfo = true;
  }

  if (batchHasMissingInfo) {
    revalidatePath(`/queue/${commitmentId}`);
    return {
      actions: selected.map((suggestion) => {
        const action = prepared.get(suggestion.id)!;
        return resultFor(action, action.execution_state ?? "needs_info", {
          inputData: action.input_data,
          missing: action.missing_data,
        });
      }),
      complete: false,
    };
  }

  const { data: priorApprovals, error: approvalLookupError } = await sessionDb
    .from("approval_event").select("subject_id")
    .eq("org_id", context.commitment.org_id)
    .eq("subject_type", "commitment_action_suggestion")
    .eq("state", "approved")
    .in("subject_id", selected.map((suggestion) => suggestion.id));
  if (approvalLookupError) throw approvalLookupError;
  const approvedIds = new Set((priorApprovals ?? []).map((row) => row.subject_id as string));
  const newApprovals = selected.filter((suggestion) => !approvedIds.has(suggestion.id));
  for (const suggestion of newApprovals) {
    const { error } = await sessionDb.from("approval_event").insert({
      org_id: context.commitment.org_id,
      subject_type: "commitment_action_suggestion",
      subject_id: suggestion.id,
      state: "approved",
      actor_user_id: uid,
    });
    if (error && error.code !== "23505") throw error;
  }

  let createdDocUrl = context.suggestions.find((suggestion) =>
    suggestion.action_type === "drive_document" && suggestion.external_url,
  )?.external_url ?? null;
  const handlers: Record<SuggestedActionType, (suggestion: CommitmentActionSuggestion) => Promise<ActionExecutionResult>> = {
    drive_document: async (suggestion) => executeClaimedAction(service, prepared.get(suggestion.id)!, async () => {
      const action = prepared.get(suggestion.id)!;
      const data = action.input_data!;
      const token = await googleToken(action.org_id, DRIVE_SCOPE);
      let doc: { id: string; url: string } | undefined;
      await executeAction({
        action: "create_drive_document", orgId: action.org_id, actorUserId: uid,
        actor: "human", subjectType: "commitment_action_suggestion", subjectId: action.id,
        approved: true, sources: ["transcript", "client_contact"],
      }, async () => {
        doc = await createDriveClient(token).createGoogleDoc({
          actionId: action.id,
          title: data.document_title!,
          body: data.document_body!,
        });
      });
      if (!doc) throw new Error("Google Doc creation did not return a resource.");
      createdDocUrl = doc.url;
      return doc;
    }),

    calendar_event: async (suggestion) => {
      const action = prepared.get(suggestion.id)!;
      if (action.external_id) return resultFor(action, "created", {
        externalId: action.external_id, externalUrl: action.external_url,
      });
      try {
        const token = await googleToken(action.org_id, CALENDAR_SCOPE);
        const calendar = createCalendarClient(token);
        const schedule = await inspectCalendarSchedule(
          calendar,
          action.input_data!,
          calendarEventId(action.id),
        );
        const conflictPreview = schedule.conflicts.map((event) => ({
          id: event.id, title: event.title, start: event.start, end: event.end ?? null,
        }));
        const data = { ...action.input_data, time_zone: schedule.timeZone };
        if (schedule.conflicts.length > 0 && !data.conflict_confirmed) {
          await setActionState(service, action, {
            input_data: data,
            preview_data: { conflicts: conflictPreview },
            execution_state: "schedule_conflict",
            last_error: null,
          });
          return resultFor(action, "schedule_conflict");
        }
        await setActionState(service, action, {
          input_data: data,
          preview_data: { conflicts: conflictPreview },
        });
        action.input_data = data;
        return executeClaimedAction(service, action, async () => {
          let event: { id: string; htmlLink?: string } | undefined;
          await executeAction({
            action: "create_calendar_event", orgId: action.org_id, actorUserId: uid,
            actor: "human", subjectType: "commitment_action_suggestion", subjectId: action.id,
            approved: true, sources: ["transcript", "client_contact"],
          }, async () => {
            event = await calendar.createEvent({
              actionId: action.id,
              title: calendarTitle(data),
              start: schedule.start.toISOString(),
              end: schedule.end.toISOString(),
              timeZone: schedule.timeZone,
              location: data.location,
              notes: data.notes,
              recurrence: data.recurrence_rule,
            });
          });
          if (!event) throw new Error("Calendar did not return the created event.");
          return {
            id: event.id,
            url: event.htmlLink ?? "https://calendar.google.com/calendar/u/0/r",
          };
        });
    } catch (error) {
      if (error instanceof GoogleApiError && error.reconnectRequired) {
        await recordGoogleApiAuthFailure(service, action.org_id, error).catch((cleanupError) => {
          logFailure("approveDetectedActions.calendar_event.preflight.authCleanup", cleanupError);
        });
      }
      const state = executionFailureState(error);
        const message = error instanceof Error ? error.message : "Calendar check failed";
        await setActionState(service, action, { execution_state: state, last_error: message.slice(0, 500) });
        logFailure("approveDetectedActions.calendar_event.preflight", error);
        return resultFor(action, state, { error: message });
      }
    },

    internal_task: async (suggestion) => executeClaimedAction(service, prepared.get(suggestion.id)!, async () => {
      const action = prepared.get(suggestion.id)!;
      const { data: existing, error: lookupError } = await service.from("task")
        .select("id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
      if (lookupError) throw lookupError;
      let taskId = existing?.id as string | undefined;
      if (!taskId) {
        await executeAction({
          action: "create_internal_task", orgId: action.org_id, actorUserId: uid,
          actor: "human", subjectType: "commitment", subjectId: commitmentId,
          approved: true, sources: ["transcript", "client_contact"],
        }, async () => {
          const { data: task, error } = await service.from("task").insert({
            org_id: action.org_id,
            commitment_id: commitmentId,
            title: context.commitment.text,
            owner: context.commitment.owner,
            due: context.commitment.deadline,
          }).select("id").single();
          if (error) throw error;
          taskId = task.id as string;
        });
      }
      if (!taskId) throw new Error("Task creation did not return a task.");
      return { id: taskId, url: `/tasks` };
    }),

    gmail_draft: async (suggestion) => executeClaimedAction(service, prepared.get(suggestion.id)!, async () => {
      const action = prepared.get(suggestion.id)!;
      if (createdDocUrl) {
        const { data: latestDraft, error: latestDraftError } = await service.from("deliverable_draft")
          .select("id,body,provider_draft_id").eq("commitment_id", commitmentId).limit(1).single();
        if (latestDraftError) throw latestDraftError;
        if (!latestDraft.provider_draft_id) {
          const { error } = await service.from("deliverable_draft")
            .update({ body: appendDocLink(latestDraft.body as string, createdDocUrl) })
            .eq("id", latestDraft.id as string).eq("org_id", action.org_id);
          if (error) throw error;
        }
      }
      const pushed = await pushApprovedDraft(commitmentId);
      if (!pushed.pushed || !pushed.providerDraftId) {
        if (["missing", "revoked", "scope", "refused", "google_reconnect_required", "gmail_auth_rejected_retry"]
          .includes(pushed.reason ?? "")) throw new ReconnectGoogleError();
        throw new Error(pushed.reason ?? "Gmail draft creation failed");
      }
      return { id: pushed.providerDraftId, url: GMAIL_DRAFTS_URL };
    }),
  };

  const result = await runApprovedActionSelection(
    selected.map((suggestion) => prepared.get(suggestion.id)!),
    handlers,
  );

  for (const action of result.actions) {
    if (action.state !== "blocked") continue;
    const suggestion = prepared.get(action.id)!;
    await setActionState(service, suggestion, {
      execution_state: "blocked",
      last_error: action.error?.slice(0, 500) ?? "Blocked by a failed dependency.",
    });
  }

  const taskCreated = result.actions.some((action) =>
    action.type === "internal_task" && action.state === "created");
  if (taskCreated && context.commitment.status !== "done") {
    const { error } = await service.from("commitment").update({ status: "tasked" })
      .eq("id", commitmentId).eq("org_id", context.commitment.org_id);
    if (error) throw error;
  } else if (context.commitment.status === "proposed" && newApprovals.length > 0) {
    const { error } = await service.from("commitment").update({ status: "approved" })
      .eq("id", commitmentId).eq("org_id", context.commitment.org_id);
    if (error) throw error;
  }

  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
  // Carry the server-authoritative readiness back with the result so the review card can
  // reflect it immediately, not only after a refresh.
  return {
    ...result,
    actions: result.actions.map((action) => {
      const preparedAction = prepared.get(action.id);
      return {
        ...action,
        inputData: preparedAction?.input_data,
        missing: preparedAction?.missing_data,
      };
    }),
  };
}

export interface PushSummary {
  pushed: boolean;
  reason?: string;
  providerDraftId?: string | null;
  providerMessageId?: string | null;
}

/**
 * Legacy single-Gmail approval path. Authorization comes from the
 * session-scoped draft lookup; service role is used only after that row proves the org.
 */
async function pushApprovedDraft(commitmentId: string): Promise<PushSummary> {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data: draft, error: draftError } = await s.from("deliverable_draft")
    .select("id,org_id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
  if (draftError) throw draftError;
  if (!draft) return { pushed: false, reason: "no draft to push" };
  const orgId = draft.org_id as string;
  const service = getServiceClient();
  const decision = canExecute("push_email_draft", true, await contractFor(service, orgId),
    { sources: ["client_contact"] });
  if (!decision.ok) return { pushed: false, reason: decision.reason };

  const { data: source, error: sourceLookupError } = await service.from("connected_data_source")
    .select("id,account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();
  if (sourceLookupError) throw sourceLookupError;
  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);
    const result = await pushDraftToGmail(service, {
      draftId: draft.id as string,
      orgId,
      userId: uid,
      from: (source?.account_email as string | undefined) ?? "me",
      accessToken: token,
    });
    return {
      pushed: true,
      providerDraftId: result.providerDraftId,
      providerMessageId: result.providerMessageId,
    };
  } catch (error) {
    if (error instanceof DataSourceUnavailable) return { pushed: false, reason: error.reason };
    if (error instanceof GmailInvalidGrantError) {
      if (source?.id) {
        await service.from("connected_data_source")
          .update({ state: "error", last_error: error.message, updated_at: new Date().toISOString() })
          .eq("id", source.id as string);
        invalidateCachedToken(source.id as string);
      }
      return { pushed: false, reason: "google_reconnect_required" };
    }
    if (error instanceof GmailUnauthorizedError) {
      if (source?.id) invalidateCachedToken(source.id as string);
      return { pushed: false, reason: "gmail_auth_rejected_retry" };
    }
    return { pushed: false, reason: error instanceof Error ? error.message : "push failed" };
  }
}

export async function rejectCommitment(commitmentId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;
  const { error: rejectError } = await s.from("approval_event").insert({
    org_id: c.org_id,
    subject_type: "commitment",
    subject_id: commitmentId,
    state: "rejected",
    actor_user_id: uid,
  });
  if (rejectError) throw rejectError;
  const { error: updateError } = await s.from("commitment").update({ status: "rejected" })
    .eq("id", commitmentId).eq("org_id", c.org_id);
  if (updateError) throw updateError;
  await logAudit({
    orgId: c.org_id,
    actor: "human",
    action: "update",
    target: `commitment:${commitmentId}:reject`,
  });
  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
}
