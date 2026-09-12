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
});
