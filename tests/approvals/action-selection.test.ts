import { describe, expect, it, vi } from "vitest";
import {
  runApprovedActionSelection,
  selectPersistedSuggestions,
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

describe("detected action approval selection", () => {
  it("accepts only persisted suggestion IDs and removes duplicates", () => {
    const rows = [suggestion("gmail", "gmail_draft"), suggestion("task", "internal_task")];
    expect(selectPersistedSuggestions(["task", "task"], rows)).toEqual([rows[1]]);
    expect(() => selectPersistedSuggestions(["invented"], rows)).toThrow(/no longer available/i);
    expect(() => selectPersistedSuggestions([], rows)).toThrow(/select at least one/i);
  });

  it("executes Gmail and task independently when both are selected", async () => {
    const createTask = vi.fn().mockResolvedValue(undefined);
    const pushGmailDraft = vi.fn().mockResolvedValue({ pushed: true });
    const result = await runApprovedActionSelection([
      suggestion("gmail", "gmail_draft"),
      suggestion("task", "internal_task"),
    ], { createTask, pushGmailDraft });

    expect(createTask).toHaveBeenCalledOnce();
    expect(pushGmailDraft).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ taskCreated: true, gmail: { pushed: true } });
  });

  it("does not execute Calendar or Drive provider actions", async () => {
    const createTask = vi.fn().mockResolvedValue(undefined);
    const pushGmailDraft = vi.fn().mockResolvedValue({ pushed: true });
    const result = await runApprovedActionSelection([
      suggestion("calendar", "calendar_event"),
      suggestion("drive", "drive_document"),
    ], { createTask, pushGmailDraft });

    expect(createTask).not.toHaveBeenCalled();
    expect(pushGmailDraft).not.toHaveBeenCalled();
    expect(result.proposedOnly).toEqual(["calendar_event", "drive_document"]);
  });

  it("creates a Gmail draft without creating an internal task", async () => {
    const createTask = vi.fn().mockResolvedValue(undefined);
    const pushGmailDraft = vi.fn().mockResolvedValue({ pushed: true });
    await runApprovedActionSelection(
      [suggestion("gmail", "gmail_draft")],
      { createTask, pushGmailDraft },
    );

    expect(pushGmailDraft).toHaveBeenCalledOnce();
    expect(createTask).not.toHaveBeenCalled();
  });
});
