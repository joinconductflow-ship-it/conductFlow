import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import {
  scopeCheckSchema, EXTRACTION_MODEL, MAX_SCOPE_SUMMARY_CHARS, MAX_SCOPE_REQUEST_CHARS,
  type ScopeCheck,
} from "./schema";
import { SCOPE_CHECK_SYSTEM_PROMPT, buildScopeCheckPrompt } from "./prompts";
import { sanitizeIngested } from "./injection";
import { generateObjectWithRetry } from "./generate";
import { contractFor } from "./blueprint-store";
import { canExecute } from "./execute-policy";

export interface ScopeCheckInput {
  commitmentText: string;
  scopeSummary: string;
}

export interface ScopeCheckResult extends ScopeCheck {
  flagged: string[];
}

async function callWithOneRetry(input: ScopeCheckInput, model?: LanguageModel) {
  return generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: SCOPE_CHECK_SYSTEM_PROMPT,
    prompt: buildScopeCheckPrompt(input),
    schema: scopeCheckSchema,
    operation: "scope_check",
  });
}

export async function checkScope(
  input: ScopeCheckInput, model?: LanguageModel,
): Promise<ScopeCheckResult> {
  for (const [label, value, max] of [
    ["Scope summary", input.scopeSummary, MAX_SCOPE_SUMMARY_CHARS],
    ["Commitment text", input.commitmentText, MAX_SCOPE_REQUEST_CHARS],
  ] as const) {
    if (!value.trim()) throw new Error(`${label} must not be blank.`);
    if (value.length > max) {
      throw new Error(`${label} is too long: ${value.length} characters (max ${max}).`);
    }
  }

  const flagged = [
    ...sanitizeIngested(input.scopeSummary).flagged,
    ...sanitizeIngested(input.commitmentText).flagged,
  ];
  const output = await callWithOneRetry(input, model);
  return { ...output, flagged };
}

export interface ScopeCommitment {
  id: string;
  org_id: string;
  client_id: string | null;
  text: string;
}

export type ScopeGateResult =
  | { outcome: "skipped"; reason: "no_scope_of_work" }
  | { outcome: "denied"; reason: string }
  | { outcome: "covered"; check: ScopeCheckResult }
  | { outcome: "change_order_drafted"; check: ScopeCheckResult; draftId: string };

// Future ingest integration belongs before the commitment INSERT in
// finishIngestAfterExtraction (lib/ingest/run.ts): pass ctx.orgId/ctx.clientId as
// org_id/client_id, c.text as text, and a preallocated id reused by the INSERT.
// Branch on the outcome before adding to pairs, so out-of-scope work cannot get a normal
// follow-up draft. Enabling that branch for orgs still needs a product decision.
export async function gateCommitmentScope(
  db: SupabaseClient, commitment: ScopeCommitment,
  options: { approved?: boolean } = {}, model?: LanguageModel,
): Promise<ScopeGateResult> {
  if (!commitment.client_id) return { outcome: "skipped", reason: "no_scope_of_work" };

  const { data: scope, error } = await db.from("scope_of_work").select("id,summary")
    .eq("org_id", commitment.org_id).eq("client_id", commitment.client_id).maybeSingle();
  if (error) throw error;
  if (!scope) return { outcome: "skipped", reason: "no_scope_of_work" };

  // Permission covers the comparison too, so denied sources never reach the model.
  const decision = canExecute("draft_change_order", options.approved ?? false,
    await contractFor(db, commitment.org_id),
    { sources: ["transcript", "client_contact", "scope_of_work"] });
  if (!decision.ok) return { outcome: "denied", reason: decision.reason };

  const check = await checkScope({
    commitmentText: commitment.text, scopeSummary: scope.summary as string,
  }, model);
  if (check.covered) return { outcome: "covered", check };

  const { data: draft, error: draftError } = await db.from("client_message_draft").insert({
    org_id: commitment.org_id, client_id: commitment.client_id,
    kind: "change_order", source_id: commitment.id,
    subject: "Scope review: proposed change order",
    body: `Hello,\n\nI'd like to confirm the scope before proceeding with this request: ${commitment.text}\n\n` +
      `It may need a change order: ${check.reason}\n\n` +
      "Could we review the additional work and agree on any scope, fee, and timing changes before proceeding?\n\nThank you.",
  }).select("id").single();
  if (draftError) throw draftError;
  return { outcome: "change_order_drafted", check, draftId: draft.id as string };
}
