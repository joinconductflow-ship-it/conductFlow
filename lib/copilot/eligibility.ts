import type { SupabaseClient } from "@supabase/supabase-js";
import {
  copilotDateContext,
  resolveRelativeDate,
  type CopilotDateContext,
} from "@/lib/copilot/date-context";

export interface EligibilityCommitment {
  id: string;
  org_id: string;
  status: string;
}

export interface EligibilitySuggestion {
  id: string;
  org_id: string;
  commitment_id: string;
  action_type: string;
  confidence: string;
  execution_state?: string | null;
  external_id?: string | null;
}

export type ProposalIneligibilityReason =
  | "no_commitment"
  | "wrong_org"
  | "commitment_not_open"
  | "no_action"
  | "action_type_mismatch"
  | "low_confidence"
  | "already_created";

export interface EligibilityVerdict {
  eligible: boolean;
  reason?: ProposalIneligibilityReason;
}

/**
 * Structural gate: an actionable proposal must be backed by a real, eligible canonical
 * ConductFlow record. Model-supplied IDs are never trusted; the caller loads the rows
 * org-scoped and this decides. Fails closed on any mismatch.
 */
export function evaluateProposalEligibility(args: {
  orgId: string;
  requestedCommitmentId: string;
  requestedActionId: string;
  requestedActionType: string;
  commitment: EligibilityCommitment | null;
  suggestion: EligibilitySuggestion | null;
}): EligibilityVerdict {
  const { commitment, suggestion } = args;
  if (!commitment || commitment.id !== args.requestedCommitmentId) return { eligible: false, reason: "no_commitment" };
  if (commitment.org_id !== args.orgId) return { eligible: false, reason: "wrong_org" };
  if (commitment.status !== "proposed") return { eligible: false, reason: "commitment_not_open" };
  if (!suggestion || suggestion.id !== args.requestedActionId ||
      suggestion.commitment_id !== args.requestedCommitmentId) {
    return { eligible: false, reason: "no_action" };
  }
  if (suggestion.org_id !== args.orgId) return { eligible: false, reason: "wrong_org" };
  if (suggestion.action_type !== args.requestedActionType) return { eligible: false, reason: "action_type_mismatch" };
  if (suggestion.confidence !== "high" && suggestion.confidence !== "medium") {
    return { eligible: false, reason: "low_confidence" };
  }
  if (suggestion.external_id || suggestion.execution_state === "created") {
    return { eligible: false, reason: "already_created" };
  }
  return { eligible: true };
}

export interface ProposalEligibilityResult extends EligibilityVerdict {
  dateContext: CopilotDateContext;
  /** Server-resolved ISO date when the proposal carried a relative date phrase. */
  resolvedDate?: string;
}

/**
 * Loads the canonical rows org-scoped (never trusting the supplied IDs) and evaluates
 * eligibility. Also returns the authoritative date context and, when `dateText` is a
 * relative phrase, the server-resolved ISO date.
 */
export async function loadProposalEligibility(
  db: SupabaseClient,
  args: {
    orgId: string;
    commitmentId: string;
    actionId: string;
    actionType: string;
    dateText?: string;
    now?: Date;
  },
): Promise<ProposalEligibilityResult> {
  const { data: org, error: orgError } = await db.from("organization")
    .select("timezone").eq("id", args.orgId).maybeSingle();
  if (orgError) throw orgError;

  const dateContext = copilotDateContext(args.now ?? new Date(), (org?.timezone as string | undefined) ?? "UTC");

  const { data: commitment, error: commitmentError } = await db.from("commitment")
    .select("id,org_id,status")
    .eq("id", args.commitmentId).eq("org_id", args.orgId).maybeSingle();
  if (commitmentError) throw commitmentError;

  const { data: suggestion, error: suggestionError } = await db.from("commitment_action_suggestion")
    .select("id,org_id,commitment_id,action_type,confidence,execution_state,external_id")
    .eq("id", args.actionId).eq("org_id", args.orgId).maybeSingle();
  if (suggestionError) throw suggestionError;

  const verdict = evaluateProposalEligibility({
    orgId: args.orgId,
    requestedCommitmentId: args.commitmentId,
    requestedActionId: args.actionId,
    requestedActionType: args.actionType,
    commitment: (commitment as EligibilityCommitment | null) ?? null,
    suggestion: (suggestion as EligibilitySuggestion | null) ?? null,
  });

  const resolvedDate = verdict.eligible && args.dateText
    ? resolveRelativeDate(args.dateText, dateContext)
    : undefined;

  return { ...verdict, dateContext, resolvedDate };
}
