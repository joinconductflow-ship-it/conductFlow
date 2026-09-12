import { describe, expect, it, vi } from "vitest";
import {
  buildCopilotApprovalPayload,
  reviewerFieldsFromTouched,
  runProposalDecision,
  type CopilotApprovalPayload,
  type ProposalValues,
} from "@/lib/copilot/schemas";
import { actionReadiness } from "@/lib/approvals/action-readiness";
import type { Commitment, CommitmentActionSuggestion } from "@/lib/types";

function commitment(): Commitment {
  return {
    id: "commitment-1",
    org_id: "org-1",
    conversation_id: "conversation-1",
    client_id: "client-1",
    text: "meet next Tuesday at 4 PM",
    owner: "Alex",
    deadline: "2026-09-15",
    type: "meeting",
    confidence: "high",
    source_span: "meet next Tuesday at 4 PM",
    status: "proposed",
    created_at: "2026-09-12T00:00:00.000Z",
    source_flagged: false,
  };
}

const suggestion: CommitmentActionSuggestion = {
  id: "suggestion-calendar",
  org_id: "org-1",
  commitment_id: "commitment-1",
  action_type: "calendar_event",
  confidence: "high",
  rationale: "The commitment schedules a meeting.",
  required_data: ["start_time", "duration"],
  missing_data: [],
  input_data: { duration_minutes: 60 },
  created_at: "2026-09-12T00:00:00.000Z",
};

const context = { commitment: commitment(), clientName: "Client", draft: null };
const identity = { commitmentId: "commitment-1", actionId: "suggestion-calendar" };

const baseValues: ProposalValues = {
  date: "2026-09-15",
  startTime: "16:00",
  durationMinutes: "60",
  documentTitle: "",
  documentDetails: "",
};

function readinessFor(payload: CopilotApprovalPayload) {
  return actionReadiness(
    suggestion, context, payload.inputData, payload.reviewerEditedFields, payload.clearedFields,
  );
}

describe("Copilot proposal transport", () => {
  it("A. executes a reviewer edit without any model-mediated copying", async () => {
    const execute = vi.fn(async (_payload: CopilotApprovalPayload) => ({ actions: [], complete: true }));
    const result = await runProposalDecision(
      true, identity, { ...baseValues, startTime: "17:00" }, ["startTime"], [], execute,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const payload = execute.mock.calls[0][0] as CopilotApprovalPayload;
    expect(payload.inputData.start_time).toBe("17:00");
    expect(payload.reviewerEditedFields).toEqual(["start_time"]);
    expect(readinessFor(payload).data.start_time).toBe("17:00");
    expect(result).toEqual({ approved: true, execution: { actions: [], complete: true } });
  });

  it("B. leaves an untouched agent value system-owned so source correction still applies", async () => {
    const execute = vi.fn(async (_payload: CopilotApprovalPayload) => ({}));
    await runProposalDecision(true, identity, { ...baseValues, startTime: "18:00" }, [], [], execute);

    const payload = execute.mock.calls[0][0] as CopilotApprovalPayload;
    expect(payload.reviewerEditedFields).toEqual([]);
    expect(readinessFor(payload).data.start_time).toBe("16:00");
  });

  it("C. keeps a reviewer-cleared time missing and reviewer-owned", async () => {
    const execute = vi.fn(async (_payload: CopilotApprovalPayload) => ({}));
    await runProposalDecision(true, identity, { ...baseValues, startTime: "" }, ["startTime"], ["startTime"], execute);

    const payload = execute.mock.calls[0][0] as CopilotApprovalPayload;
    expect(payload.inputData.start_time).toBeUndefined();
    expect(payload.reviewerEditedFields).toEqual(["start_time"]);
    expect(payload.clearedFields).toEqual(["start_time"]);

    const readiness = readinessFor(payload);
    expect(readiness.data.start_time).toBeUndefined();
    expect(readiness.missing).toContain("start_time");
  });

  it("D. never executes on reject", async () => {
    const execute = vi.fn(async (_payload: CopilotApprovalPayload) => ({}));
    const result = await runProposalDecision(false, identity, baseValues, ["startTime"], [], execute);

    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({ approved: false });
  });

  it("E. model output cannot alter the payload that was executed", async () => {
    const executed: CopilotApprovalPayload[] = [];
    const execute = vi.fn(async (payload: CopilotApprovalPayload) => {
      executed.push(structuredClone(payload));
      return { actions: [{ id: "a", type: "calendar_event", state: "created" }], complete: true };
    });

    const values = { ...baseValues, startTime: "17:00" };
    const result = await runProposalDecision(true, identity, values, ["startTime"], [], execute);
    const expected = buildCopilotApprovalPayload(identity, values, ["startTime"]);
    expect(executed[0]).toEqual(expected);

    // Anything the model later says is narration only; the executed payload is already fixed.
    (result as { execution?: unknown }).execution = { tampered: "by-model" };
    expect(executed[0]).toEqual(expected);
  });

  it("F. transports a cleared field as reviewer-owned with no value", async () => {
    const execute = vi.fn(async (_payload: CopilotApprovalPayload) => ({}));
    await runProposalDecision(true, identity, { ...baseValues, date: "" }, ["date"], ["date"], execute);

    const payload = execute.mock.calls[0][0] as CopilotApprovalPayload;
    expect(payload.inputData.date).toBeUndefined();
    expect(payload.reviewerEditedFields).toEqual(["date"]);
    expect(payload.clearedFields).toEqual(["date"]);

    const readiness = readinessFor(payload);
    expect(readiness.data.date).toBeUndefined();
    expect(readiness.missing).toContain("date");
  });

  it("G. distinguishes omitted, supplied, and explicitly cleared", async () => {
    const execute = vi.fn(async (_payload: CopilotApprovalPayload) => ({}));

    await runProposalDecision(true, identity, baseValues, [], [], execute);
    const omitted = execute.mock.calls[0][0] as CopilotApprovalPayload;
    expect(omitted.reviewerEditedFields).toEqual([]);
    expect(omitted.clearedFields).toEqual([]);

    await runProposalDecision(true, identity, { ...baseValues, startTime: "17:00" }, ["startTime"], [], execute);
    const supplied = execute.mock.calls[1][0] as CopilotApprovalPayload;
    expect(supplied.inputData.start_time).toBe("17:00");
    expect(supplied.reviewerEditedFields).toEqual(["start_time"]);
    expect(supplied.clearedFields).toEqual([]);

    await runProposalDecision(true, identity, { ...baseValues, startTime: "" }, ["startTime"], ["startTime"], execute);
    const cleared = execute.mock.calls[2][0] as CopilotApprovalPayload;
    expect(cleared.inputData.start_time).toBeUndefined();
    expect(cleared.reviewerEditedFields).toEqual(["start_time"]);
    expect(cleared.clearedFields).toEqual(["start_time"]);
  });

  it("tracks reviewer ownership from touched fields, including cleared ones", () => {
    expect(reviewerFieldsFromTouched(["startTime", "documentDetails"])).toEqual([
      "start_time", "document_details",
    ]);
    expect(reviewerFieldsFromTouched(["startTime", "startTime"])).toEqual(["start_time"]);
    expect(reviewerFieldsFromTouched([])).toEqual([]);
  });
});
