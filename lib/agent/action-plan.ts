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

// The prompt asks for these, but a model can still return only internal_task for an explicit
// "make a study guide" commitment. This is the deterministic backstop, not a broad
// classifier: the six artifact nouns named in the prompt, each directly governed by a
// creation verb. Requiring the verb to govern the noun (with only determiners/adjectives
// between them) is what stops "make sure the report reaches the client" from counting.
const ARTIFACT_NOUNS = ["study guide", "report", "proposal", "outline", "worksheet", "checklist"];
const CREATION_VERB = "(?:make|makes|making|create|creates|creating|write|writes|writing|draft|drafts|drafting|prepare|prepares|preparing|build|builds|building|produce|produces|producing|develop|develops|developing)";
const ARTIFACT_LEAD = "(?:a|an|the|my|our|their|his|her|its|this|that|new|final|short|brief|quick|simple|detailed|full|complete|one-page|one page)";
const ARTIFACT_CREATION_RE = new RegExp(
  `\\b${CREATION_VERB}\\b\\s+(?:(?:${ARTIFACT_LEAD})\\s+){0,2}(?:${ARTIFACT_NOUNS.join("|")})\\b`,
  "i",
);

function createsNamedArtifact(input: ActionPlanInput): boolean {
  return ARTIFACT_CREATION_RE.test(`${input.commitmentText}\n${input.sourceSpan}`);
}

/**
 * Guarantees a drive_document for an explicit artifact-creation commitment when the model
 * omitted one. It never removes or rewrites what the model returned — internal_task may
 * coexist — and it never duplicates an existing drive_document.
 */
export function normalizeArtifactActions(plan: ActionPlan, input: ActionPlanInput): ActionPlan {
  if (plan.actions.some((action) => action.type === "drive_document")) return plan;
  if (!createsNamedArtifact(input)) return plan;
  return {
    actions: [...plan.actions, {
      type: "drive_document",
      confidence: "medium",
      rationale: "The commitment authors an artifact, so a shared Google Doc should be created.",
      required_data: ["document_title", "document_content"],
      missing_data: [],
    }],
  };
}

/**
 * Extraction establishes what was promised. This independent step only decides which
 * supported follow-through actions, if any, deserve a later human review.
 */
export async function planCommitmentActions(
  input: ActionPlanInput,
  model?: LanguageModel,
): Promise<ActionPlan> {
  const plan = await generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: ACTION_PLAN_SYSTEM_PROMPT,
    prompt: buildActionPlanPrompt(input),
    schema: actionPlanSchema,
    operation: "action_plan",
  });
  return normalizeArtifactActions(plan, input);
}
