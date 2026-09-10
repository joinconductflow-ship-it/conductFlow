"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { getServiceClient } from "@/lib/db/service";
import { getCurrentOrgId } from "@/lib/db/queries";
import { respondToReview, setReviewStatus } from "@/lib/reviews/respond";
import { pushClientMessageToGmail } from "@/lib/gmail/push-client-message";
import { GmailInvalidGrantError, GmailUnauthorizedError } from "@/lib/gmail/client";
import { getAccessToken, invalidateCachedToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { CAPABILITIES } from "@/lib/google/scopes";

const GMAIL_COMPOSE_SCOPE = CAPABILITIES.gmail_drafts.scopes[0];

async function session() {
  const db = await getServerClient();
  const { data } = await db.auth.getUser();
  if (!data.user) throw new Error("Sign in to manage review requests.");
  return { db, userId: data.user.id };
}

export async function submitReview(args: {
  rawReview: string; clientId?: string | null; source?: string | null;
  reviewerName?: string | null; rating?: number | null;
}) {
  const { db } = await session();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to draft a review response.");
  const source = args.source === "google" || args.source === "yelp"
    || args.source === "facebook" || args.source === "other" ? args.source : null;
  const result = await respondToReview(db, { ...args, orgId, source });
  revalidatePath("/reviews");
  return result;
}

export async function markReviewStatus(reviewId: string, next: "responded" | "dismissed") {
  const { db } = await session();
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("Sign in to update a review.");
  await setReviewStatus(db, { orgId, reviewId, next });
  revalidatePath("/reviews");
}

/** Same shape as pushRetainerDraft/pushDocumentDraft — org from the draft row via RLS. */
export async function pushReviewRequestDraft(draftId: string) {
  const { db, userId } = await session();
  const { data: draft } = await db.from("client_message_draft")
    .select("id,org_id").eq("id", draftId).maybeSingle();
  if (!draft) return { pushed: false, reason: "draft not found" };
  const orgId = draft.org_id as string;

  const service = getServiceClient();
  const { data: source } = await service.from("connected_data_source")
    .select("id,account_email").eq("org_id", orgId).eq("provider", "google").maybeSingle();

  try {
    const token = await getAccessToken(service, orgId, GMAIL_COMPOSE_SCOPE);
    const result = await pushClientMessageToGmail(service, {
      draftId: draft.id as string, orgId, userId,
      from: (source?.account_email as string | undefined) ?? "me",
      accessToken: token,
    });
    revalidatePath("/reviews");
    return { pushed: result.outcome === "pushed", reason: result.outcome };
  } catch (e) {
    if (e instanceof DataSourceUnavailable) return { pushed: false, reason: e.reason };
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
