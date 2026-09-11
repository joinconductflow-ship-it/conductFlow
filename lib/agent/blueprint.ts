import type { AgentContract } from "./contract";

/**
 * Fixed in code, never in a row, never editable by an owner. These are the promises the
 * product makes to the people whose data it handles — an owner cannot grant them away,
 * a tampered row cannot smuggle them in, and a bug in an editor cannot widen them.
 */
export const HARD_PROHIBITED = [
  "send_external_email",
  "change_scope",
  "change_pricing",
  "sign_contract",
  "take_payment",
  "delete_record",
] as const;

/** Actions an owner may actually decide about. */
export const EDITABLE_ACTIONS = [
  "draft_recap",
  "draft_task_list",
  "draft_follow_up",
  "create_internal_task",
  "propose_recurring_task",
  "push_email_draft",
  "edit_crm",
  "draft_retainer_renewal",
  "draft_document_reminder",
  "draft_reschedule_offer",
  "draft_change_order",
  "draft_invoice",
  "draft_collections_reminder",
  "draft_payment_risk_checkin",
  "draft_review_request",
  "draft_review_response",
  "draft_lead_reply",
] as const;

/**
 * These reach a customer or an outside system. An org may decide *whether* the agent does
 * them at all, but never that it does them unattended.
 */
export const ALWAYS_NEEDS_APPROVAL = ["push_email_draft", "edit_crm"] as const;

export type EditableAction = (typeof EDITABLE_ACTIONS)[number];

export interface BlueprintRow {
  allowed_sources: string[];
  permitted_actions: string[];
  required_approvals: string[];
  escalation_conditions: string[];
  success_metric: string;
  expires_in_minutes: number;
}

/** What a new org starts with: draft freely, ask before anything else. */
export const DEFAULT_BLUEPRINT: BlueprintRow = {
  allowed_sources: ["transcript", "client_contact", "template", "scope_of_work", "lead_inquiry", "review_text", "invoice"],
  permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up",
    "draft_retainer_renewal", "draft_document_reminder", "draft_reschedule_offer", "draft_change_order",
    "draft_invoice", "draft_collections_reminder", "draft_payment_risk_checkin", "draft_review_request", "draft_review_response",
    "draft_lead_reply"],
  required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
    "propose_recurring_task"],
  escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
  success_metric: "follow_up_sent_within_24h",
  expires_in_minutes: 60,
};

/**
 * The row an org edits, plus the limits it cannot edit. Prohibitions are appended here
 * rather than read from the row, and canExecute checks prohibitions first — so a
 * permitted_actions entry naming a prohibited action loses.
 *
 * ALWAYS_NEEDS_APPROVAL is re-applied here too, not only in validateBlueprintEdit: a row
 * that never passed through the editor — a forged PostgREST insert, say — cannot grant an
 * external action unattended. It is demoted to approval-gated at read time.
 */
export function blueprintToContract(row: BlueprintRow & { created_at?: string | null }): AgentContract {
  const prohibited = HARD_PROHIBITED as readonly string[];
  const alwaysApproval = ALWAYS_NEEDS_APPROVAL as readonly string[];

  const permitted = row.permitted_actions.filter(
    (a) => !prohibited.includes(a) && !alwaysApproval.includes(a));

  // An always-approval action the row tried to grant unattended is demoted, not dropped:
  // dropping it would make canExecute answer "unknown_action" and deny an action the owner
  // legitimately enabled. The row loses the "unattended" part of its claim, nothing more.
  const demoted = row.permitted_actions.filter(
    (a) => !prohibited.includes(a) && alwaysApproval.includes(a));

  const required = [...new Set([...row.required_approvals, ...demoted])]
    .filter((a) => !prohibited.includes(a));

  return {
    trigger: "approved transcript ready for extraction",
    allowedSources: row.allowed_sources,
    permittedActions: permitted,
    requiredApprovals: required,
    prohibitedActions: [...HARD_PROHIBITED],
    escalationConditions: row.escalation_conditions,
    successMetric: row.success_metric,
    expiresInMinutes: row.expires_in_minutes,
    createdAt: row.created_at ?? null,
  };
}

export interface EditResult { ok: boolean; error?: string }

export function validateBlueprintEdit(row: Omit<BlueprintRow, "allowed_sources"> & {
  allowed_sources: string[];
}): EditResult {
  const known = new Set<string>(EDITABLE_ACTIONS);
  const all = [...row.permitted_actions, ...row.required_approvals];

  for (const action of all) {
    if ((HARD_PROHIBITED as readonly string[]).includes(action)) {
      return { ok: false, error: `"${action}" is never available to the agent, at any approval level.` };
    }
    if (!known.has(action)) {
      return { ok: false, error: `Unknown action "${action}".` };
    }
  }

  for (const action of row.permitted_actions) {
    if (row.required_approvals.includes(action)) {
      return { ok: false, error: `"${action}" cannot be both unattended and approval-gated.` };
    }
    if ((ALWAYS_NEEDS_APPROVAL as readonly string[]).includes(action)) {
      return { ok: false, error: `"${action}" reaches someone outside the team and always needs approval.` };
    }
  }

  if (!Number.isInteger(row.expires_in_minutes)
    || row.expires_in_minutes < 1 || row.expires_in_minutes > 1440) {
    return { ok: false, error: "Token expiry must be between 1 and 1440 minutes." };
  }
  if (!row.success_metric.trim()) {
    return { ok: false, error: "Give the agent a success metric." };
  }

  return { ok: true };
}
