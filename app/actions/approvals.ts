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
import { revalidatePath } from "next/cache";
import type { Commitment } from "@/lib/types";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function currentUserId(): Promise<string | null> {
  const s = await getServerClient();
  const { data } = await s.auth.getUser();
  return data.user?.id ?? null;
}

export async function approveAndCreateTask(commitmentId: string) {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data, error: fetchError } = await s.from("commitment").select("*")
    .eq("id", commitmentId).single();
  if (fetchError || !data) throw new Error("commitment not found");
  const c = data as Commitment;

  // A commitment past `proposed` was already approved. Re-clicking approve (e.g. after a
  // failed Gmail push) must not insert a second approval_event/task or flip a `done`
  // commitment back to `tasked` — it should only retry the push.
  if (c.status === "proposed") {
    await executeAction(
      { action: "create_internal_task", orgId: c.org_id, actorUserId: uid, actor: "human",
        // This copies an approved commitment into a task; it fetches no source data.
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
      }
    );
  }
  // The Gmail push is a separate, approval-gated action. It runs after the task exists so
  // a Google failure never costs the approval — the user can retry it from the review screen.
  const push = await pushApprovedDraft(commitmentId);
  revalidatePath("/queue");
  revalidatePath(`/queue/${commitmentId}`);
  return push;
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
 * `approveAndCreateTask`. The draft lookup runs on the session-scoped client, so RLS is what
 * proves the caller may see this commitment's draft at all — every service-role call after it
 * uses the org that RLS already vouched for, never a value an untrusted caller could supply.
 */
export async function pushApprovedDraft(commitmentId: string): Promise<PushSummary> {
  const uid = await currentUserId();
  const s = await getServerClient();
  const { data: draft } = await s.from("deliverable_draft")
    .select("id,org_id").eq("commitment_id", commitmentId).limit(1).maybeSingle();
  if (!draft) return { pushed: false, reason: "no draft to push" };
  const orgId = draft.org_id as string;

  const service = getServiceClient();
  // The org's own blueprint, not a constant: an owner who switched push_email_draft off
  // must actually get no Gmail draft.
  const decision = canExecute("push_email_draft", true, await contractFor(service, orgId),
    { sources: ["client_contact"] });
  if (!decision.ok) return { pushed: false, reason: decision.reason };

  const { data: source } = await service.from("connected_data_source")
    .select("id,account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();

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
