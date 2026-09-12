import type { SupabaseClient } from "@supabase/supabase-js";
import { createGmailClient, type GmailClient } from "./client";
import { buildRawMessage, hashRawMessage } from "./mime";
import { logAudit } from "@/lib/audit/log";

export const GMAIL_PROVIDER = "gmail";

export interface PushArgs {
  /** The `deliverable_draft` row to place in the mailbox. */
  draftId: string;
  /**
   * The org the caller is authorized for, established upstream via RLS — never trust a
   * value that reaches this function only because a caller typed it in. Checked against
   * both the draft row and its commitment before anything is sent to Gmail, so a draft
   * whose `commitment_id` was pointed at a foreign org's commitment can't leak that org's
   * client email into this org's mailbox.
   */
  orgId: string;
  userId: string | null;
  /** Address of the connected account, used as the From header. */
  from: string;
  /** Required when no Gmail client is injected. */
  accessToken?: string;
  now?: Date;
}

export type PushOutcome = "pushed" | "recreated" | "already_pushed";

export interface PushResult {
  outcome: PushOutcome;
  providerDraftId: string | null;
  providerMessageId: string | null;
}

interface DraftRow {
  id: string;
  org_id: string;
  commitment_id: string;
  subject: string | null;
  body: string;
  provider_draft_id: string | null;
}

/** Exported so a rewrite (`lib/drafts/regenerate.ts`) can drop a stale Gmail link too. */
export const CLEARED = {
  provider: null, provider_draft_id: null, provider_message_id: null,
  pushed_at: null, pushed_by: null,
};

/** Never a real Gmail id (those come back from the API); claims the row before calling out. */
const CLAIM_SENTINEL = "__pending__";

/**
 * Places an existing `deliverable_draft` in the connected account's Gmail drafts.
 *
 * Idempotent under concurrency, not just by inspection: a row that already carries
 * `provider_draft_id` is left alone, and a conditional claim (`provider_draft_id is null`)
 * taken before calling Gmail means two racing approvals can't both create a draft — Postgres
 * serializes the two updates to the same row, so only the first to commit sees its claim
 * succeed. If the recorded draft has been deleted in Gmail, the columns are cleared and a
 * fresh one takes its place — the record self-heals rather than pointing at nothing.
 *
 * Injected Supabase and Gmail clients, the same seam as `runIngest(db, args, model?)`.
 *
 * The caller is responsible for the contract chokepoint (`executeAction` with
 * `push_email_draft`) and for catching failures: every error here is typed, and an
 * approval must survive one.
 */
export async function pushDraftToGmail(
  db: SupabaseClient, args: PushArgs, gmail?: GmailClient,
): Promise<PushResult> {
  const client = gmail ?? createGmailClient(requireToken(args.accessToken));
  const now = args.now ?? new Date();

  const { data, error } = await db.from("deliverable_draft")
    .select("id,org_id,commitment_id,subject,body,provider_draft_id")
    .eq("id", args.draftId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("deliverable draft not found");
  const draft = data as unknown as DraftRow;
  if (draft.org_id !== args.orgId) {
    throw new Error("deliverable draft does not belong to the caller's org");
  }

  let recreating = false;
  if (draft.provider_draft_id === CLAIM_SENTINEL) {
    return { outcome: "already_pushed", providerDraftId: null, providerMessageId: null };
  }
  if (draft.provider_draft_id) {
    const { exists } = await client.getDraft(draft.provider_draft_id);
    if (exists) {
      return {
        outcome: "already_pushed",
        providerDraftId: draft.provider_draft_id,
        providerMessageId: null,
      };
    }
    const { error: clearError } = await db.from("deliverable_draft")
      .update(CLEARED).eq("id", draft.id);
    if (clearError) throw clearError;
    recreating = true;
  }

  // Atomic claim: Postgres serializes concurrent updates to the same row, so whichever of
  // two racing approvals commits first flips `provider_draft_id` away from null, and the
  // loser's conditional update matches zero rows instead of both calling Gmail's API. The
  // sentinel is released on any failure below, so a throttled or skipped push still leaves
  // `provider_draft_id` null for a later retry — only a genuine Gmail draft id should stick.
  const { data: claimed, error: claimError } = await db.from("deliverable_draft")
    .update({ provider_draft_id: CLAIM_SENTINEL })
    .eq("id", draft.id).is("provider_draft_id", null).select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    return { outcome: "already_pushed", providerDraftId: null, providerMessageId: null };
  }
  const releaseClaim = async () => {
    const { error: releaseError } = await db.from("deliverable_draft")
      .update({ provider_draft_id: null })
      .eq("id", draft.id)
      .eq("provider_draft_id", CLAIM_SENTINEL);
    if (releaseError) throw releaseError;
  };

  let raw: string;
  let created: { draftId: string; messageId: string };
  try {
    const recipient = await recipientFor(db, draft.commitment_id, args.orgId);
    raw = buildRawMessage({
      to: recipient,
      from: args.from,
      subject: draft.subject ?? "",
      body: draft.body,
    });
    created = await client.createDraft(raw);
  } catch (e) {
    await releaseClaim();
    throw e;
  }

  const { error: updateError } = await db.from("deliverable_draft").update({
    provider: GMAIL_PROVIDER,
    provider_draft_id: created.draftId,
    provider_message_id: created.messageId,
    pushed_at: now.toISOString(),
    pushed_by: args.userId,
  }).eq("id", draft.id);
  if (updateError) throw updateError;

  await logAudit({
    orgId: draft.org_id, actor: "agent", action: "create",
    target: `deliverable_draft:${draft.id}:gmail_push`,
    payloadHash: hashRawMessage(raw),
  });

  return {
    outcome: recreating ? "recreated" : "pushed",
    providerDraftId: created.draftId,
    providerMessageId: created.messageId,
  };
}

function requireToken(accessToken?: string): string {
  if (!accessToken) throw new Error("A Gmail access token is required to push a draft.");
  return accessToken;
}

async function recipientFor(
  db: SupabaseClient, commitmentId: string, orgId: string,
): Promise<string | null> {
  const { data: commitment, error: commitmentError } = await db.from("commitment")
    .select("client_id,org_id").eq("id", commitmentId).maybeSingle();
  if (commitmentError) throw commitmentError;
  if (!commitment) throw new Error("commitment not found for deliverable draft");
  // The draft's own org_id already passed the caller-org check above; this confirms the
  // commitment it points at is actually in that org too, so a draft row whose
  // `commitment_id` was pointed at a foreign org's commitment can't resolve that org's
  // client email as a recipient.
  if (commitment.org_id !== orgId) {
    throw new Error("commitment does not belong to deliverable draft's org");
  }
  if (!commitment.client_id) return null;

  const { data: client, error: clientError } = await db.from("client_contact")
    .select("email").eq("id", commitment.client_id as string).maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw new Error("client not found for commitment");
  const email = (client.email as string | null | undefined)?.trim() ?? "";
  return email || null;
}
