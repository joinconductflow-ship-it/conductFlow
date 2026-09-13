"use server";

import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { loadProposalEligibility } from "@/lib/copilot/eligibility";
import type { SuggestedActionType } from "@/lib/types";

export interface CopilotProposalCheck {
  eligible: boolean;
  /** User-safe, non-actionable explanation when the proposal cannot proceed. */
  message?: string;
  /** Server-resolved ISO date (YYYY-MM-DD) when the proposal carried a relative phrase. */
  resolvedDate?: string;
  /** Authoritative current date in the org timezone, for display/debugging. */
  currentDate?: string;
}

const INELIGIBLE_MESSAGE =
  "I don't have an eligible commitment to create this action from yet.";

/**
 * Fail-closed structural gate before a Copilot approval card can become actionable. Model-
 * supplied IDs are looked up org-scoped; a missing, foreign, closed, stale, low-confidence,
 * or type-mismatched record yields a non-actionable result. Read-only — no execution path.
 */
export async function verifyCopilotProposal(args: {
  commitmentId: string;
  actionId: string;
  actionType: SuggestedActionType;
  dateText?: string;
}): Promise<CopilotProposalCheck> {
  try {
    const orgId = await getCurrentOrgId("copilot: verifyProposal");
    if (!orgId) return { eligible: false, message: "Sign in to review a proposal." };

    const db = await getServerClient();
    const result = await loadProposalEligibility(db, {
      orgId,
      commitmentId: args.commitmentId,
      actionId: args.actionId,
      actionType: args.actionType,
      dateText: args.dateText,
    });

    if (!result.eligible) {
      return { eligible: false, message: INELIGIBLE_MESSAGE, currentDate: result.dateContext.date };
    }
    return {
      eligible: true,
      resolvedDate: result.resolvedDate,
      currentDate: result.dateContext.date,
    };
  } catch {
    // Never reject: the proposal card depends on a terminal verdict to resolve the
    // proposeAction interrupt. A transient auth/DB failure fails closed instead.
    return { eligible: false, message: INELIGIBLE_MESSAGE };
  }
}
