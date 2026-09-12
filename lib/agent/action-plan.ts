import type { LanguageModel } from "ai";
import {
  actionPlanSchema,
  EXTRACTION_MODEL,
  type SuggestedAction,
} from "./schema";
import { ACTION_PLAN_SYSTEM_PROMPT, buildActionPlanPrompt } from "./prompts";
import { generateObjectWithRetry } from "./generate";

export interface ActionPlanInput {
  commitmentText: string;
  owner: string | null;
  deadline: string | null;
  commitmentType: string;
  sourceSpan: string;
}

export interface ActionPlan {
  actions: SuggestedAction[];
}

/**
 * Extraction establishes what was promised. This independent step only decides which
 * supported follow-through actions, if any, deserve a later human review.
 */
export async function planCommitmentActions(
  input: ActionPlanInput,
  model?: LanguageModel,
): Promise<ActionPlan> {
  return generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: ACTION_PLAN_SYSTEM_PROMPT,
    prompt: buildActionPlanPrompt(input),
    schema: actionPlanSchema,
    operation: "action_plan",
  });
}
