"use server";
import { revalidatePath } from "next/cache";
import { getServerClient } from "@/lib/db/server";
import { regenerateDraftFor } from "@/lib/drafts/regenerate";
import { presentDraftFailure, type RegenerateDraftResult } from "@/lib/drafts/failure";
import { GenerationFailure } from "@/lib/agent/generate";
import { logFailure } from "@/lib/observability/log";

export async function regenerateDraft(commitmentId: string): Promise<RegenerateDraftResult> {
  try {
    const db = await getServerClient();
    const { data } = await db.auth.getUser();
    if (!data.user) return { ok: false, message: "Sign in to write a draft." };

    await regenerateDraftFor(db, { commitmentId });
    revalidatePath(`/queue/${commitmentId}`);
    return { ok: true };
  } catch (error) {
    // An expected rate-limit failure must not surface as a Next.js Server Components
    // error. Log only sanitized generation metadata (never the prompt/transcript), then
    // hand the UI a controlled, provider-free message.
    if (error instanceof GenerationFailure) {
      logFailure("regenerateDraft.generation", {
        error_type: error.errorType,
        status: error.status,
        retryable: error.retryable,
        operation: error.operation,
        action_type: error.actionType,
        attempts: error.attempts,
      });
    }
    return { ok: false, ...presentDraftFailure(error) };
  }
}
