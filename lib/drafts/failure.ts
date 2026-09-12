import { GenerationFailure } from "@/lib/agent/generate";

export interface RegenerateDraftResult {
  ok: boolean;
  message?: string;
  rateLimited?: boolean;
}

// The only non-generation errors safe to show a user: application-authored messages that
// carry no database, policy, or provider detail. Supabase/PostgREST errors are deliberately
// excluded — their messages can name tables, constraints, and RLS policies.
const SAFE_APP_ERROR_MESSAGES = ["commitment not found", "action denied:"] as const;

function isKnownSafeAppError(error: unknown): error is Error {
  return error instanceof Error && SAFE_APP_ERROR_MESSAGES.some((prefix) =>
    error.message === prefix || error.message.startsWith(prefix));
}

/**
 * Turns a failed manual draft generation into user-safe copy. A `GenerationFailure` is
 * already payload-free, so it is never shown verbatim; a retryable one (a rate limit that
 * outlived the bounded retries) becomes a short, actionable message. Anything that is not an
 * explicitly allow-listed application error collapses to generic copy.
 */
export function presentDraftFailure(error: unknown): Omit<RegenerateDraftResult, "ok"> {
  if (error instanceof GenerationFailure) {
    if (error.retryable) {
      return {
        message: "AI drafting is temporarily rate-limited. Try again shortly.",
        rateLimited: true,
      };
    }
    return { message: "AI drafting failed. Try again shortly.", rateLimited: false };
  }
  if (isKnownSafeAppError(error)) return { message: error.message, rateLimited: false };
  return { message: "The draft could not be written. Please try again.", rateLimited: false };
}
