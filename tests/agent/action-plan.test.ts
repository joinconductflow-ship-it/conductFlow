import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { planCommitmentActions } from "@/lib/agent/action-plan";

function modelReturning(payload: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const input = {
  commitmentText: "Schedule a follow-up with the client next week",
  owner: "Alex",
  deadline: null,
  commitmentType: "call",
  sourceSpan: "I'll schedule a follow-up with you next week.",
};

describe("planCommitmentActions", () => {
  it("returns only the suggested supported actions and their missing data", async () => {
    const result = await planCommitmentActions(input, modelReturning({ actions: [
      {
        type: "calendar_event", confidence: "high", rationale: "A follow-up meeting was promised.",
        required_data: ["event_title", "start_time", "end_time", "attendees"],
        missing_data: ["start_time", "end_time", "attendees"],
      },
      {
        type: "internal_task", confidence: "medium", rationale: "The scheduling work should be tracked.",
        required_data: ["task_title", "owner"], missing_data: [],
      },
    ] }));
    expect(result.actions.map((action) => action.type)).toEqual(["calendar_event", "internal_task"]);
    expect(result.actions[0].missing_data).toContain("start_time");
  });

  it("permits no action instead of inventing an email follow-up", async () => {
    const result = await planCommitmentActions({ ...input, commitmentText: "Consider the idea." },
      modelReturning({ actions: [] }));
    expect(result.actions).toEqual([]);
  });

  it("adds drive_document when the model misses an explicit artifact", async () => {
    const result = await planCommitmentActions({
      commitmentText: "make a study guide covering chapters 4 through 6",
      owner: "Alex",
      deadline: null,
      commitmentType: "deliverable",
      sourceSpan: "make a study guide covering chapters 4 through 6",
    }, modelReturning({ actions: [{
      type: "internal_task", confidence: "high", rationale: "Track the request.",
      required_data: ["task_title"], missing_data: [],
    }] }));

    expect(result.actions.map((action) => action.type)).toEqual(
      expect.arrayContaining(["internal_task", "drive_document"]));
    expect(result.actions.find((action) => action.type === "drive_document")?.confidence).not.toBe("low");
  });

  it("does not convert a normal non-artifact internal task", async () => {
    const result = await planCommitmentActions({
      commitmentText: "Update the internal lesson plan",
      owner: "Alex",
      deadline: null,
      commitmentType: "deliverable",
      sourceSpan: "I'll update the internal lesson plan on Friday",
    }, modelReturning({ actions: [{
      type: "internal_task", confidence: "high", rationale: "Track the internal prep.",
      required_data: ["task_title"], missing_data: [],
    }] }));

    expect(result.actions.map((action) => action.type)).toEqual(["internal_task"]);
  });

  it("does not force drive_document when the artifact is not the object of the verb", async () => {
    const result = await planCommitmentActions({
      commitmentText: "make sure the report reaches the client",
      owner: "Alex",
      deadline: null,
      commitmentType: "deliverable",
      sourceSpan: "make sure the report reaches the client",
    }, modelReturning({ actions: [{
      type: "internal_task", confidence: "high", rationale: "Track the follow-up.",
      required_data: ["task_title"], missing_data: [],
    }] }));

    expect(result.actions.map((action) => action.type)).toEqual(["internal_task"]);
  });

  it("does not duplicate a drive_document the model already returned", async () => {
    const result = await planCommitmentActions({
      commitmentText: "write a report for the client",
      owner: "Alex",
      deadline: null,
      commitmentType: "deliverable",
      sourceSpan: "I'll write a report for the client",
    }, modelReturning({ actions: [{
      type: "drive_document", confidence: "high", rationale: "A shared file is needed.",
      required_data: ["document_title"], missing_data: [],
    }] }));

    expect(result.actions.filter((action) => action.type === "drive_document")).toHaveLength(1);
  });
});
