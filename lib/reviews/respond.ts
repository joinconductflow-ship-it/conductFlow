import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import {
  reviewResponseSchema, EXTRACTION_MODEL, MAX_REVIEW_CHARS, type ReviewResponse,
} from "@/lib/agent/schema";
import { REVIEW_RESPONSE_SYSTEM_PROMPT, buildReviewResponsePrompt } from "@/lib/agent/prompts";
import { sanitizeIngested } from "@/lib/agent/injection";
import { generateObjectWithRetry } from "@/lib/agent/generate";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

export interface RespondToReviewArgs {
  orgId: string;
  rawReview: string;
  clientId?: string | null;
  source?: "google" | "yelp" | "facebook" | "other" | null;
  reviewerName?: string | null;
  rating?: number | null;
  now?: Date;
}

export interface RespondToReviewResult {
  reviewId: string;
  flagged: string[];
  response: ReviewResponse | null;
  denied?: string;
}

export async function respondToReview(
  db: SupabaseClient, args: RespondToReviewArgs, model?: LanguageModel,
): Promise<RespondToReviewResult> {
  if (!args.rawReview.trim()) throw new Error("Paste the review text.");
  if (args.rawReview.length > MAX_REVIEW_CHARS) {
    throw new Error(`Review is too long: ${args.rawReview.length} characters (max ${MAX_REVIEW_CHARS}).`);
  }

  const { flagged } = sanitizeIngested(args.rawReview);
  const { data: review, error: reviewError } = await db.from("received_review").insert({
    org_id: args.orgId, client_id: args.clientId ?? null, source: args.source ?? null,
    reviewer_name: args.reviewerName ?? null, rating: args.rating ?? null,
    raw_review: args.rawReview, status: "new", sentiment: "neutral", urgency: "low",
    drafted_response: null,
  }).select("id").single();
  if (reviewError) throw reviewError;
  const reviewId = review.id as string;

  const contract = await contractFor(db, args.orgId);
  const decision = canExecute("draft_review_response", true, contract, { sources: ["review_text"] });
  if (!decision.ok) return { reviewId, flagged, response: null, denied: decision.reason };

  const response = await generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: REVIEW_RESPONSE_SYSTEM_PROMPT,
    prompt: buildReviewResponsePrompt({
      rawReview: args.rawReview, rating: args.rating ?? null,
      reviewerName: args.reviewerName ?? null, source: args.source ?? null,
    }),
    schema: reviewResponseSchema,
    operation: "review_response",
  });

  const { error: updateError } = await db.from("received_review").update({
    sentiment: response.sentiment, urgency: response.urgency, drafted_response: response.responseDraft,
  }).eq("id", reviewId).eq("org_id", args.orgId);
  if (updateError) throw updateError;

  await logAudit({
    orgId: args.orgId, actor: "agent", action: "draft", target: `received_review:${reviewId}:respond`,
  });
  return { reviewId, flagged, response };
}

export interface SetReviewStatusArgs {
  orgId: string;
  reviewId: string;
  next: "responded" | "dismissed";
}

export async function setReviewStatus(db: SupabaseClient, args: SetReviewStatusArgs): Promise<void> {
  const { data: review, error } = await db.from("received_review")
    .select("id,org_id").eq("id", args.reviewId).maybeSingle();
  if (error) throw error;
  if (!review || review.org_id !== args.orgId) throw new Error("review not found");

  const { error: updateError } = await db.from("received_review")
    .update({ status: args.next }).eq("id", review.id).eq("org_id", args.orgId);
  if (updateError) throw updateError;
  await logAudit({
    orgId: args.orgId, actor: "human", action: "update", target: `received_review:${review.id}:${args.next}`,
  });
}
