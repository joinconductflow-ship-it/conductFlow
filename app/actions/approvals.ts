"use server";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { executeAction } from "@/lib/agent/execute";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { pushDraftToGmail } from "@/lib/gmail/push";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";
import { logAudit } from "@/lib/audit/log";
import {
  runApprovedActionSelection,
  selectPersistedSuggestions,
} from "@/lib/approvals/action-selection";
import { revalidatePath } from "next/cache";
import type { Commitment, CommitmentActionSuggestion } from "@/lib/types";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function currentUserId(): Promise<string> {
  const s = await getServerClient();
  const { data, error } = await s.auth.getUser();
  if (error || !data.user) throw new Error("Unable to verify your session. Please sign in again.");
  return data.user.id;
}

export async function approveDetectedActions(commitmentId: string, selectedActionIds: string[]) {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;

  // Never trust action types posted by the client. RLS first proves this user can read the
  // commitment's persisted planner output, then IDs are matched against exactly those rows.
  const { data: suggestionRows, error: suggestionError } = await s
    .from("commitment_action_suggestion")
    .select("id,org_id,commitment_id,action_type,confidence,rationale,required_data,missing_data,created_at")
    .eq("commitment_id", commitmentId)
    .eq("org_id", c.org_id);
  if (suggestionError) throw suggestionError;
  const selected = selectPersistedSuggestions(
    selectedActionIds,
    (suggestionRows ?? []) as CommitmentActionSuggestion[],
  );

  const { data: existingApprovals, error: approvalLookupError } = await s
    .from("approval_event")
    .select("subject_id")
    .eq("org_id", c.org_id)
    .eq("subject_type", "commitment_action_suggestion")
    .eq("state", "approved")
    .in("subject_id", selected.map((suggestion) => suggestion.id));
  if (approvalLookupError) throw approvalLookupError;
  const approvedIds = new Set((existingApprovals ?? []).map((row) => row.subject_id as string));
  const newApprovals = selected.filter((suggestion) => !approvedIds.has(suggestion.id));
  if (newApprovals.length > 0) {
    const { error: actionApprovalError } = await s.from("approval_event").insert(
      newApprovals.map((suggestion) => ({
        org_id: c.org_id,
        subject_type: "commitment_action_suggestion",
        subject_id: suggestion.id,
        state: "approved",
        actor_user_id: uid,
      })),
    );
    if (actionApprovalError) throw actionApprovalError;
  }

  const result = await runApprovedActionSelection(selected, {
    createTask: async () => {
      const { data: existingTask, error: taskLookupError } = await s.from("task")
        .select("id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
      if (taskLookupError) throw taskLookupError;
      if (existingTask) {
        if (c.status === "proposed" || c.status === "approved") {
          const { error: updateError } = await s.from("commitment").update({ status: "tasked" })
            .eq("id", commitmentId).eq("org_id", c.org_id);
          if (updateError) throw updateError;
        }
        return;
      }

      await executeAction(
        { action: "create_internal_task", orgId: c.org_id, actorUserId: uid, actor: "human",
          subjectType: "commitment", subjectId: commitmentId, approved: true, sources: [] },
        async () => {
          const { error: approvalError } = await s.from("approval_event").insert({
            org_id: c.org_id, subject_type: "commitment",
            subject_id: commitmentId, state: "approved", actor_user_id: uid });
          if (approvalError) throw approvalError;
          const { error: taskError } = await s.from("task").insert({ org_id: c.org_id,
            commitment_id: commitmentId, title: c.text, owner: c.owner, due: c.deadline });
          if (taskError) throw taskError;
          const { error: updateError } = await s.from("commitment").update({ status: "tasked" })
            .eq("id", commitmentId).eq("org_id", c.org_id);
          if (updateError) throw updateError;
        },
      );
    },
    pushGmailDraft: () => pushApprovedDraft(commitmentId),
  });

  // An approval without a task is still a reviewed commitment. Calendar and Drive remain
  // proposals only; this status change does not execute either provider action.
  if (!selected.some((suggestion) => suggestion.action_type === "internal_task") &&
      c.status === "proposed") {
    const { error: updateError } = await s.from("commitment").update({ status: "approved" })
      .eq("id", commitmentId).eq("org_id", c.org_id);
    if (updateError) throw updateError;
  }

  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
  return result;
}

export interface PushSummary { pushed: boolean; reason?: string }

/**
 * Places the approved follow-up in the connected Gmail account's drafts. Never sends —
 * `send_external_email` is prohibited by the contract at every approval level.
 *
 * Returns rather than throws: an org with no Google connection is the normal case today,
 * not an error worth failing an approval over.
 *
 * `orgId` and the actor come from the session, not from the caller, on purpose: this is an
 * exported server action, reachable directly from the client independent of
 * `approveDetectedActions`. The draft lookup runs on the session-scoped client, so RLS is what
 * proves the caller may see this commitment's draft at all — every service-role call after it
 * uses the org that RLS already vouched for, never a value an untrusted caller could supply.
 */
export async function pushApprovedDraft(commitmentId: string): Promise<PushSummary> {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data: draft, error: draftLookupError } = await s.from("deliverable_draft")
    .select("id,org_id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
  // A lookup failure must not read as "no draft exists" — the caller's UI treats that
  // reason as silent-by-design, so a transient error here would approve with no visible
  // sign the Gmail push never happened.
  if (draftLookupError) throw draftLookupError;
  if (!draft) return { pushed: false, reason: "no draft to push" };
  const orgId = draft.org_id as string;

  const service = getServiceClient();
  // The org's own blueprint, not a constant: an owner who switched push_email_draft off
  // must actually get no Gmail draft.
  const decision = canExecute("push_email_draft", true, await contractFor(service, orgId),
    { sources: ["client_contact"] });
  if (!decision.ok) return { pushed: false, reason: decision.reason };

  const { data: source, error: sourceLookupError } = await service.from("connected_data_source")
    .select("id,account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();
  if (sourceLookupError) throw sourceLookupError;

  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);

    const result = await pushDraftToGmail(service, {
      draftId: draft.id as string, orgId, userId: uid,
      from: (source?.account_email as string | undefined) ?? "me",
      accessToken: token,
    });
    return { pushed: result.outcome === "pushed" || result.outcome === "recreated",
      reason: result.outcome };
  } catch (e) {
    if (e instanceof DataSourceUnavailable) return { pushed: false, reason: e.reason };
    // Gmail's own auth failures need a consumer, not just a stringified message: a revoked
    // grant must flip the connection to `error` so /settings shows it needs reconnecting,
    // and a rejected access token must drop out of the cache so the very next attempt
    // refreshes instead of handing back the same token Gmail just rejected.
    if (e instanceof GmailInvalidGrantError) {
      if (source?.id) {
        await service.from("connected_data_source")
          .update({ state: "error", last_error: e.message, updated_at: new Date().toISOString() })
          .eq("id", source.id as string);
        invalidateCachedToken(source.id as string);
      }
      return { pushed: false, reason: "google_reconnect_required" };
    }
    if (e instanceof GmailUnauthorizedError) {
      if (source?.id) invalidateCachedToken(source.id as string);
      return { pushed: false, reason: "gmail_auth_rejected_retry" };
    }
    return { pushed: false, reason: e instanceof Error ? e.message : "push failed" };
  }
}

export async function rejectCommitment(commitmentId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;
  const { error: rejectError } = await s.from("approval_event").insert({ org_id: c.org_id,
    subject_type: "commitment", subject_id: commitmentId, state: "rejected", actor_user_id: uid });
  if (rejectError) throw rejectError;
  const { error: updateError } = await s.from("commitment").update({ status: "rejected" })
    .eq("id", commitmentId).eq("org_id", c.org_id);
  if (updateError) throw updateError;
  await logAudit({ orgId: c.org_id, actor: "human", action: "update",
    target: `commitment:${commitmentId}:reject` });
  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
}
