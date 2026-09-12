import type { CommitmentActionSuggestion, SuggestedActionType } from "@/lib/types";

export interface ApprovedActionRunResult {
  gmail?: { pushed: boolean; reason?: string };
  taskCreated: boolean;
  proposedOnly: SuggestedActionType[];
}

export function selectPersistedSuggestions(
  requestedIds: readonly string[],
  suggestions: readonly CommitmentActionSuggestion[],
): CommitmentActionSuggestion[] {
  const uniqueIds = [...new Set(requestedIds)];
  if (uniqueIds.length === 0) throw new Error("Select at least one detected action");

  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const selected = uniqueIds.map((id) => byId.get(id));
  if (selected.some((suggestion) => !suggestion)) {
    throw new Error("One or more selected actions are no longer available");
  }
  return selected as CommitmentActionSuggestion[];
}

export async function runApprovedActionSelection(
  selected: readonly CommitmentActionSuggestion[],
  handlers: {
    createTask: () => Promise<void>;
    pushGmailDraft: () => Promise<{ pushed: boolean; reason?: string }>;
  },
): Promise<ApprovedActionRunResult> {
  const types = new Set(selected.map((suggestion) => suggestion.action_type));
  let taskCreated = false;
  let gmail: ApprovedActionRunResult["gmail"];

  if (types.has("internal_task")) {
    await handlers.createTask();
    taskCreated = true;
  }
  if (types.has("gmail_draft")) gmail = await handlers.pushGmailDraft();

  return {
    gmail,
    taskCreated,
    proposedOnly: (["calendar_event", "drive_document"] as const)
      .filter((type) => types.has(type)),
  };
}
