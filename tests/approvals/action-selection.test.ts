import { describe, expect, it, vi } from "vitest";
import {
  runApprovedActionSelection,
  selectPersistedSuggestions,
  type ActionExecutionResult,
} from "@/lib/approvals/action-selection";
import type { CommitmentActionSuggestion, SuggestedActionType } from "@/lib/types";

function suggestion(id: string, action_type: SuggestedActionType): CommitmentActionSuggestion {
  return {
    id,
    org_id: "org-1",
    commitment_id: "commitment-1",
    action_type,
    confidence: "high",
    rationale: "This action fits the commitment.",
    required_data: [],
    missing_data: [],
    created_at: "2026-09-11T00:00:00.000Z",
  };
}

type Handler = (suggestion: CommitmentActionSuggestion) => Promise<ActionExecutionResult>;

function created(type: SuggestedActionType): Handler {
  return async (s) => ({ id: s.id, type, state: "created", externalId: s.id, externalUrl: null });
}

function makeHandlers(overrides: Partial<Record<SuggestedActionType, Handler>> = {}) {
  return {
    drive_document: vi.fn(overrides.drive_document ?? created("drive_document")),
    calendar_event: vi.fn(overrides.calendar_event ?? created("calendar_event")),
    internal_task: vi.fn(overrides.internal_task ?? created("internal_task")),
    gmail_draft: vi.fn(overrides.gmail_draft ?? created("gmail_draft")),
  };
}

describe("detected action approval selection", () => {
  it("accepts only persisted suggestion IDs and removes duplicates", () => {
    const rows = [suggestion("gmail", "gmail_draft"), suggestion("task", "internal_task")];
    expect(selectPersistedSuggestions(["task", "task"], rows)).toEqual([rows[1]]);
    expect(() => selectPersistedSuggestions(["invented"], rows)).toThrow(/no longer available/i);
    expect(() => selectPersistedSuggestions([], rows)).toThrow(/select at least one/i);
  });

  it("rejects a low-confidence action outright", () => {
    const low = { ...suggestion("low", "gmail_draft"), confidence: "low" as const };
    expect(() => selectPersistedSuggestions(["low"], [low])).toThrow(/low-confidence/i);
  });

  it("executes each selected action exactly once, in dependency order", async () => {
    const handlers = makeHandlers();
    const result = await runApprovedActionSelection([
      suggestion("gmail", "gmail_draft"),
      suggestion("task", "internal_task"),
      suggestion("drive", "drive_document"),
    ], handlers);

    expect(handlers.drive_document).toHaveBeenCalledOnce();
    expect(handlers.internal_task).toHaveBeenCalledOnce();
    expect(handlers.gmail_draft).toHaveBeenCalledOnce();
    expect(handlers.calendar_event).not.toHaveBeenCalled();

    const order = [handlers.drive_document, handlers.internal_task, handlers.gmail_draft]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result).toMatchObject({
      complete: true,
      actions: expect.arrayContaining([
        expect.objectContaining({ type: "drive_document", state: "created" }),
        expect.objectContaining({ type: "internal_task", state: "created" }),
        expect.objectContaining({ type: "gmail_draft", state: "created" }),
      ]),
    });
  });

  it("blocks a Gmail draft whose Google Doc dependency did not create", async () => {
    const handlers = makeHandlers({
      drive_document: async (s) => ({ id: s.id, type: "drive_document", state: "failed", error: "boom" }),
    });
    const result = await runApprovedActionSelection([
      suggestion("drive", "drive_document"),
      suggestion("gmail", "gmail_draft"),
    ], handlers);

    expect(handlers.gmail_draft).not.toHaveBeenCalled();
    expect(result.complete).toBe(false);
    expect(result.actions.find((a) => a.type === "gmail_draft")?.state).toBe("blocked");
  });

  it("does not create a Gmail draft when Drive was not part of the batch", async () => {
    const handlers = makeHandlers();
    await runApprovedActionSelection(
      [suggestion("gmail", "gmail_draft")],
      handlers,
    );

    expect(handlers.gmail_draft).toHaveBeenCalledOnce();
    expect(handlers.drive_document).not.toHaveBeenCalled();
  });

  it("keeps independent successes when one action fails", async () => {
    const handlers = makeHandlers({
      calendar_event: async (s) => ({ id: s.id, type: "calendar_event", state: "failed", error: "conflict" }),
    });
    const result = await runApprovedActionSelection([
      suggestion("task", "internal_task"),
      suggestion("calendar", "calendar_event"),
    ], handlers);

    expect(result.complete).toBe(false);
    expect(result.actions.find((a) => a.type === "internal_task")?.state).toBe("created");
    expect(result.actions.find((a) => a.type === "calendar_event")?.state).toBe("failed");
  });
});
