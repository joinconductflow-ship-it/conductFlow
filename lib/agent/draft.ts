import type { LanguageModel } from "ai";
import { draftSchema, EXTRACTION_MODEL, type GeneratedDraft } from "./schema";
import { DRAFT_SYSTEM_PROMPT, buildDraftPrompt } from "./prompts";
import { generateObjectWithRetry } from "./generate";

export interface DraftInput {
  commitmentText: string;
  clientName: string;
  deadline: string | null;
  sourceSpan: string;
  /** Optional Drive/Calendar context from lib/google/context.ts, already sanitized. */
  templateText?: string | null;
  meetingContext?: string | null;
}

export async function generateFollowUpDraft(
  input: DraftInput,
  model?: LanguageModel,
): Promise<GeneratedDraft> {
  return generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: DRAFT_SYSTEM_PROMPT,
    prompt: buildDraftPrompt(input),
    schema: draftSchema,
    operation: "draft",
    actionType: "gmail_draft",
  });
}
