import type {
  ActionExecutionState,
  CommitmentActionSuggestion,
  SuggestedActionType,
} from "@/lib/types";

export interface ActionExecutionResult {
  id: string;
  type: SuggestedActionType;
  state: ActionExecutionState;
  externalId?: string | null;
  externalUrl?: string | null;
  error?: string | null;
}

export interface ApprovedActionRunResult {
  actions: ActionExecutionResult[];
  complete: boolean;
}

type Handler = (suggestion: CommitmentActionSuggestion) => Promise<ActionExecutionResult>;

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
  if (selected.some((suggestion) => suggestion?.confidence === "low")) {
    throw new Error("Low-confidence actions cannot be approved");
  }

  // The database also enforces one row per type. Keep this guard so a malformed fixture,
  // stale migration, or future importer cannot execute duplicate outputs in one click.
  const seen = new Set<SuggestedActionType>();
  return (selected as CommitmentActionSuggestion[]).filter((suggestion) => {
    if (seen.has(suggestion.action_type)) return false;
    seen.add(suggestion.action_type);
    return true;
  });
}

const ORDER: SuggestedActionType[] = [
  "drive_document",
  "calendar_event",
  "internal_task",
  "gmail_draft",
];

function didNotCreate(result: ActionExecutionResult | undefined): boolean {
  return !!result && result.state !== "created";
}

export async function runApprovedActionSelection(
  selected: readonly CommitmentActionSuggestion[],
  handlers: Record<SuggestedActionType, Handler>,
): Promise<ApprovedActionRunResult> {
  const byType = new Map(selected.map((suggestion) => [suggestion.action_type, suggestion]));
  const results: ActionExecutionResult[] = [];

  for (const type of ORDER) {
    const suggestion = byType.get(type);
    if (!suggestion) continue;

    // A Gmail action from the same commitment uses the newly-created Doc URL. If Drive
    // failed, Gmail remains pending instead of producing a draft with a broken dependency.
    if (type === "gmail_draft" && byType.has("drive_document")) {
      const drive = results.find((result) => result.type === "drive_document");
      if (didNotCreate(drive)) {
        results.push({
          id: suggestion.id,
          type,
          state: "blocked",
          error: "Google Doc creation did not complete.",
        });
        continue;
      }
    }

    try {
      results.push(await handlers[type](suggestion));
    } catch (error) {
      results.push({
        id: suggestion.id,
        type,
        state: "failed",
        error: error instanceof Error ? error.message : "Action failed",
      });
    }
  }

  return {
    actions: results,
    complete: results.every((result) => result.state === "created"),
  };
}
