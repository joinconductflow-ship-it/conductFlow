import { describe, expect, it } from "vitest";
import {
  actionReadiness,
  calendarScheduleChanged,
  clearAcceptedOverrides,
  effectiveReviewerFields,
  initialActionData,
  mergeAcceptedReadiness,
  resolveActionInput,
  resolveEffectiveActionInput,
  sanitizeReviewerEditedFields,
  type ActionReadinessContext,
} from "@/lib/approvals/action-readiness";
import type {
  ActionExecutionState,
  ActionInputData,
  Commitment,
  CommitmentActionSuggestion,
} from "@/lib/types";

function commitment(deadline: string | null): Commitment {
  return {
    id: "commitment-1",
    org_id: "org-1",
    conversation_id: "conversation-1",
    client_id: "client-1",
    text: "Meet with the client",
    owner: "Alex",
    deadline,
    type: "meeting",
    confidence: "high",
    source_span: "Meet with the client at 2pm for 30 minutes.",
    status: "proposed",
    created_at: "2026-09-12T00:00:00.000Z",
    source_flagged: false,
  };
}

describe("initialActionData", () => {
  it("normalizes a timestamp deadline into a Calendar date default", () => {
    const data = initialActionData("calendar_event", {
      commitment: commitment("2026-09-15T00:00:00+00:00"),
      clientName: "Client",
      draft: null,
    });

    expect(data.date).toBe("2026-09-15");
  });

  it("does not use an invalid deadline as a Calendar date default", () => {
    const data = initialActionData("calendar_event", {
      commitment: commitment("next Tuesday"),
      clientName: "Client",
      draft: null,
    });

    expect(data.date).toBeUndefined();
  });
});

describe("actionReadiness", () => {
  it("allows a Gmail draft with a blank recipient when subject and body exist", () => {
    const suggestion: CommitmentActionSuggestion = {
      id: "suggestion-1",
      org_id: "org-1",
      commitment_id: "commitment-1",
      action_type: "gmail_draft",
      confidence: "high",
      rationale: "A follow-up draft was requested.",
      required_data: ["recipient", "subject", "body"],
      missing_data: ["recipient"],
      execution_state: "proposed",
      created_at: "2026-09-12T00:00:00.000Z",
    };

    const readiness = actionReadiness(suggestion, {
      commitment: commitment(null),
      clientName: "Client",
      draft: {
        id: "draft-1",
        org_id: "org-1",
        commitment_id: "commitment-1",
        kind: "email",
        subject: "Follow-up",
        body: "Here is the requested follow-up.",
        created_at: "2026-09-12T00:00:00.000Z",
      },
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
  });
});

function relativeMeeting(): Commitment {
  return {
    ...commitment("2026-09-15"),
    text: "meet next Tuesday at 4 PM",
    type: "meeting",
    source_span: "meet next Tuesday at 4 PM",
  };
}

function calendarSuggestion(input: ActionInputData = {}): CommitmentActionSuggestion {
  return {
    id: "suggestion-calendar",
    org_id: "org-1",
    commitment_id: "commitment-1",
    action_type: "calendar_event",
    confidence: "high",
    rationale: "The commitment schedules a meeting.",
    required_data: ["start_time", "duration"],
    missing_data: [],
    input_data: { duration_minutes: 60, ...input },
    execution_state: "proposed",
    created_at: "2026-09-12T00:00:00.000Z",
  };
}

function driveSuggestion(input: ActionInputData = {}): CommitmentActionSuggestion {
  return {
    id: "suggestion-drive",
    org_id: "org-1",
    commitment_id: "commitment-1",
    action_type: "drive_document",
    confidence: "high",
    rationale: "The commitment needs a shared document.",
    required_data: ["document_title", "document_content"],
    missing_data: ["document_content"],
    input_data: input,
    execution_state: "proposed",
    created_at: "2026-09-12T00:00:00.000Z",
  };
}

describe("explicit-clear tri-state across every editable field", () => {
  const meeting = (): ActionReadinessContext => ({
    commitment: {
      ...commitment("2026-09-15"),
      text: "meet next Tuesday at 4 PM for 30 minutes",
      type: "meeting",
      source_span: "meet next Tuesday at 4 PM for 30 minutes",
    },
    clientName: "Client",
    draft: null,
  });
  const clientRecord = (): ActionReadinessContext => ({
    commitment: commitment("2026-09-15"), clientName: "Client", draft: null,
  });

  // Deliberately no injected duration default: the matrix needs exact base/saved control.
  function calendarAction(input: ActionInputData): CommitmentActionSuggestion {
    return {
      id: "suggestion-calendar", org_id: "org-1", commitment_id: "commitment-1",
      action_type: "calendar_event", confidence: "high", rationale: "Schedule it.",
      required_data: ["date", "start_time", "duration"], missing_data: [],
      input_data: input, execution_state: "proposed",
      created_at: "2026-09-12T00:00:00.000Z",
    };
  }

  type FieldCase = {
    field: string;
    missing: string;
    savedValue: unknown;
    replacement: ActionInputData;
    replacementValue: unknown;
    base: unknown;
    hasBase: boolean;
    systemExpected: unknown;
    action: (input: ActionInputData) => CommitmentActionSuggestion;
    context: () => ActionReadinessContext;
    read: (data: ActionInputData) => unknown;
  };

  const fields: FieldCase[] = [
    {
      field: "date", missing: "date", savedValue: "2026-09-20",
      replacement: { date: "2026-09-25" }, replacementValue: "2026-09-25",
      base: "2026-09-15", hasBase: true, systemExpected: "2026-09-20",
      action: calendarAction, context: meeting, read: (data) => data.date,
    },
    {
      field: "start_time", missing: "start_time", savedValue: "17:00",
      replacement: { start_time: "18:00" }, replacementValue: "18:00",
      // start_time is the one field with source correction for non-owned values.
      base: "16:00", hasBase: true, systemExpected: "16:00",
      action: calendarAction, context: meeting, read: (data) => data.start_time,
    },
    {
      field: "duration_minutes", missing: "duration", savedValue: 60,
      replacement: { duration_minutes: 45 }, replacementValue: 45,
      base: 30, hasBase: true, systemExpected: 60,
      action: calendarAction, context: meeting, read: (data) => data.duration_minutes,
    },
    {
      field: "document_title", missing: "document_title", savedValue: "Client Report",
      replacement: { document_title: "New Title" }, replacementValue: "New Title",
      base: "Meet with the client", hasBase: true, systemExpected: "Client Report",
      action: driveSuggestion, context: clientRecord, read: (data) => data.document_title,
    },
    {
      field: "document_details", missing: "document_details", savedValue: "old details",
      replacement: { document_details: "new details" }, replacementValue: "new details",
      base: undefined, hasBase: false, systemExpected: "old details",
      action: driveSuggestion, context: clientRecord, read: (data) => data.document_details,
    },
  ];

  it.each(fields)("1. $field: persisted reviewer value survives an omitted submission", (f) => {
    const readiness = actionReadiness(
      f.action({ [f.field]: f.savedValue, reviewer_edited_fields: [f.field] }),
      f.context(), {}, [], [],
    );
    expect(f.read(readiness.data)).toEqual(f.savedValue);
    expect(readiness.data.reviewer_edited_fields).toContain(f.field);
  });

  it.each(fields)("2. $field: explicit clear removes the value but keeps ownership", (f) => {
    const readiness = actionReadiness(
      f.action({ [f.field]: f.savedValue, reviewer_edited_fields: [f.field] }),
      f.context(), {}, [], [f.field],
    );
    expect(f.read(readiness.data)).toBeUndefined();
    expect(readiness.data.reviewer_edited_fields).toContain(f.field);
    expect(readiness.missing).toContain(f.missing);
  });

  it.each(fields.filter((f) => f.hasBase))("3a. $field: source-derived value survives no submission", (f) => {
    const readiness = actionReadiness(f.action({}), f.context(), {}, [], []);
    expect(f.read(readiness.data)).toEqual(f.base);
  });

  it.each(fields)("3b. $field: system-owned persisted value survives no submission", (f) => {
    const readiness = actionReadiness(f.action({ [f.field]: f.savedValue }), f.context(), {}, [], []);
    expect(f.read(readiness.data)).toEqual(f.systemExpected);
    expect(readiness.data.reviewer_edited_fields).toBeUndefined();
  });

  it.each(fields)("4. $field: reviewer replacement wins and claims ownership", (f) => {
    const readiness = actionReadiness(
      f.action({ [f.field]: f.savedValue }), f.context(), f.replacement, [f.field], [],
    );
    expect(f.read(readiness.data)).toEqual(f.replacementValue);
    expect(readiness.data.reviewer_edited_fields).toContain(f.field);
  });

  it.each(fields)("5. $field: explicit clear suppresses fallback and claims ownership", (f) => {
    const readiness = actionReadiness(
      f.action({ [f.field]: f.savedValue }), f.context(), {}, [f.field], [f.field],
    );
    expect(f.read(readiness.data)).toBeUndefined();
    expect(readiness.data.reviewer_edited_fields).toContain(f.field);
    expect(readiness.missing).toContain(f.missing);
  });

  it("omission is not a clear: persisted ownership with no clear keeps the value", () => {
    const persisted = calendarSuggestion({
      start_time: "17:00", reviewer_edited_fields: ["start_time"],
    });
    const readiness = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, {}, ["start_time"], []);

    expect(readiness.data.start_time).toBe("17:00");
    expect(readiness.data.reviewer_edited_fields).toContain("start_time");
  });

  it("a persisted clear keeps suppressing fallback until a new value arrives", () => {
    const persisted = calendarSuggestion({
      reviewer_edited_fields: ["start_time"], reviewer_cleared_fields: ["start_time"],
    });
    const cleared = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, {}, [], []);
    expect(cleared.data.start_time).toBeUndefined();
    expect(cleared.data.reviewer_cleared_fields).toContain("start_time");

    const refilled = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { start_time: "17:00", duration_minutes: 60 }, ["start_time"], []);
    expect(refilled.data.start_time).toBe("17:00");
    expect(refilled.data.reviewer_cleared_fields).toBeUndefined();
  });
});

describe("calendar readiness for a relative time", () => {
  it("keeps the source time and flags that the relative date needs confirmation", () => {
    const readiness = actionReadiness(calendarSuggestion(), {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    });

    expect(readiness.data.start_time).toBe("16:00");
    expect(readiness.data.relative_date).toBe(true);
    expect(readiness.missing).toContain("relative_date_confirmation");
    expect(readiness.ready).toBe(false);
  });

  it("becomes ready once the relative date is confirmed", () => {
    const readiness = actionReadiness(calendarSuggestion(), {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { relative_date_confirmed: true });

    expect(readiness.data.start_time).toBe("16:00");
    expect(readiness.ready).toBe(true);
  });

  it("corrects a stale persisted 18:00 to the source 4 PM when the reviewer never edited it", () => {
    const readiness = actionReadiness(calendarSuggestion({ start_time: "18:00" }), {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { start_time: "18:00", duration_minutes: 60 });

    expect(readiness.data.start_time).toBe("16:00");
    expect(readiness.data.reviewer_edited_fields).toBeUndefined();
  });

  it("persists explicit reviewer provenance for a start_time edit", () => {
    const readiness = actionReadiness(calendarSuggestion({ start_time: "16:00" }), {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { start_time: "17:00", duration_minutes: 60 }, ["start_time"]);

    expect(readiness.data.start_time).toBe("17:00");
    expect(readiness.data.reviewer_edited_fields).toContain("start_time");
  });

  it("keeps the reviewer's 17:00 on a second approval with persisted provenance", () => {
    const persisted = calendarSuggestion({
      start_time: "17:00", reviewer_edited_fields: ["start_time"],
    });
    const readiness = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { start_time: "17:00", duration_minutes: 60 });

    expect(readiness.data.start_time).toBe("17:00");
  });

  it("keeps the reviewer's 17:00 across a reload that re-sends provenance", () => {
    const persisted = calendarSuggestion({
      start_time: "17:00", reviewer_edited_fields: ["start_time"],
    });
    const readiness = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { start_time: "17:00", duration_minutes: 60 }, ["start_time"]);

    expect(readiness.data.start_time).toBe("17:00");
  });

  it("honors a later reviewer edit from 17:00 to 18:00", () => {
    const persisted = calendarSuggestion({
      start_time: "17:00", reviewer_edited_fields: ["start_time"],
    });
    const readiness = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { start_time: "18:00", duration_minutes: 60 }, ["start_time"]);

    expect(readiness.data.start_time).toBe("18:00");
  });

  it("keeps a reviewer-cleared time missing instead of restoring the source default", () => {
    const persisted = calendarSuggestion({
      start_time: "16:00", reviewer_edited_fields: ["start_time"],
    });
    const readiness = actionReadiness(persisted, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, { duration_minutes: 60 }, ["start_time"], ["start_time"]);

    expect(readiness.data.start_time).toBeUndefined();
    expect(readiness.missing).toContain("start_time");
    expect(readiness.ready).toBe(false);
  });
});

describe("calendarScheduleChanged", () => {
  it("treats a source correction from stale 18:00 to 16:00 as a material change", () => {
    expect(calendarScheduleChanged({ start_time: "18:00" }, { start_time: "16:00" })).toBe(true);
  });

  it("does not treat an unchanged reviewer-owned time as a change", () => {
    expect(calendarScheduleChanged(
      { start_time: "17:00", duration_minutes: 60, date: "2026-09-15" },
      { start_time: "17:00", duration_minutes: 60, date: "2026-09-15" },
    )).toBe(false);
  });

  it("treats a reviewer time change as a material change", () => {
    expect(calendarScheduleChanged({ start_time: "17:00" }, { start_time: "18:00" })).toBe(true);
  });

  it("combines the readiness correction and the material-change decision for stale 18:00", () => {
    const saved: ActionInputData = {
      date: "2026-09-15", start_time: "18:00", duration_minutes: 60, conflict_confirmed: true,
    };
    const suggestion = {
      ...calendarSuggestion(saved),
      preview_data: { conflicts: [{ id: "c", title: null, start: "2026-09-15T18:30:00Z", end: null }] },
    };
    const readiness = actionReadiness(suggestion, {
      commitment: relativeMeeting(), clientName: "Client", draft: null,
    }, saved);

    expect(readiness.data.start_time).toBe("16:00");
    expect(calendarScheduleChanged(saved, readiness.data)).toBe(true);
  });
});

describe("reviewer provenance sanitization", () => {
  it("keeps known fields and drops unknown or duplicate ones", () => {
    expect(sanitizeReviewerEditedFields(["start_time", "start_time", "bogus", 42]))
      .toEqual(["start_time"]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(sanitizeReviewerEditedFields("start_time")).toEqual([]);
  });
});

describe("resolveActionInput", () => {
  it("layers reviewer edits over persisted server readiness", () => {
    expect(resolveActionInput(
      { start_time: "16:00", duration_minutes: 60 },
      { start_time: "17:00" },
    )).toEqual({ start_time: "17:00", duration_minutes: 60 });
  });

  it("returns persisted readiness when there are no edits", () => {
    expect(resolveActionInput({ start_time: "16:00" }, undefined)).toEqual({ start_time: "16:00" });
  });
});

function actionProps(startTime: string, state: ActionExecutionState = "ready") {
  return {
    id: "cal",
    execution_state: state,
    input_data: { start_time: startTime, duration_minutes: 60 },
    missing_data: [] as string[],
    preview_data: {},
  };
}

describe("server readiness snapshot reconciliation", () => {
  it("shows the snapshot before refresh, then lets newer authoritative props win", () => {
    // A. server action returns a readiness snapshot for the pre-approval props.
    const action = actionProps("16:00");
    const snapshots = mergeAcceptedReadiness(
      {},
      [{ id: "cal", inputData: { start_time: "17:00" } }],
      [action],
    );
    expect(resolveEffectiveActionInput(action, snapshots.cal, undefined).start_time).toBe("17:00");

    // B/C. refreshed props carry a different authoritative value -> snapshot no longer applies.
    const refreshed = actionProps("18:00");
    expect(resolveEffectiveActionInput(refreshed, snapshots.cal, undefined).start_time).toBe("18:00");
  });

  it("clears only accepted overrides and preserves unrelated unsaved edits", () => {
    const overrides = clearAcceptedOverrides(
      { cal: { start_time: "18:00" }, other: { document_details: "unsaved" } },
      [{ id: "cal", inputData: { start_time: "16:00" } }],
    );
    expect(overrides).toEqual({ other: { document_details: "unsaved" } });
  });

  it("uses snapshot provenance only until props change", () => {
    const action = actionProps("17:00");
    const snapshots = mergeAcceptedReadiness(
      {},
      [{ id: "cal", inputData: { start_time: "17:00", reviewer_edited_fields: ["start_time"] } }],
      [action],
    );
    expect(effectiveReviewerFields(action, snapshots.cal, undefined)).toEqual(["start_time"]);
    expect(effectiveReviewerFields(actionProps("18:00"), snapshots.cal, undefined)).toEqual([]);
  });

  it("still layers the reviewer's current unsaved edit over refreshed props", () => {
    const refreshed = actionProps("18:00");
    const effective = resolveEffectiveActionInput(refreshed, undefined, { start_time: "19:00" });
    expect(effective.start_time).toBe("19:00");
    expect(effective.duration_minutes).toBe(60);
  });
});
