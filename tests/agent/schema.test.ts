import { describe, it, expect } from "vitest";
import { actionPlanSchema, extractionSchema, draftSchema } from "@/lib/agent/schema";

describe("extractionSchema", () => {
  it("accepts a well-formed commitment", () => {
    const parsed = extractionSchema.parse({
      commitments: [{
        text: "Send the practice set",
        owner: "tutor@demo.test",
        deadline: "2026-08-14",
        type: "deliverable",
        confidence: "high",
        source_span: "I'll send the practice set by Friday",
      }],
    });
    expect(parsed.commitments).toHaveLength(1);
  });

  it("rejects an unknown confidence value", () => {
    expect(() => extractionSchema.parse({
      commitments: [{
        text: "x", owner: null, deadline: null, type: "email",
        confidence: "pretty sure", source_span: "x",
      }],
    })).toThrow();
  });

  it("allows null owner and deadline", () => {
    const parsed = extractionSchema.parse({
      commitments: [{
        text: "x", owner: null, deadline: null, type: "other",
        confidence: "low", source_span: "x",
      }],
    });
    expect(parsed.commitments[0].owner).toBeNull();
  });

  it("refuses a whitespace-only source_span, which would verify against any transcript", () => {
    expect(() => extractionSchema.parse({
      commitments: [{
        text: "x", owner: null, deadline: null, type: "other",
        confidence: "high", source_span: " ",
      }],
    })).toThrow();
    expect(() => extractionSchema.parse({
      commitments: [{
        text: "x", owner: null, deadline: null, type: "other",
        confidence: "high", source_span: "\t\n ",
      }],
    })).toThrow();
  });
});

describe("draftSchema", () => {
  it("requires subject and body", () => {
    expect(() => draftSchema.parse({ subject: "hi" })).toThrow();
    expect(draftSchema.parse({ subject: "hi", body: "there" }).body).toBe("there");
  });

  it("refuses a multiline subject, which would crash MIME assembly downstream", () => {
    expect(() => draftSchema.parse({ subject: "Line one\nLine two", body: "there" })).toThrow();
    expect(() => draftSchema.parse({ subject: "Line one\r\nLine two", body: "there" })).toThrow();
  });

  it("refuses a subject over 200 characters", () => {
    expect(() => draftSchema.parse({ subject: "x".repeat(201), body: "there" })).toThrow();
    expect(draftSchema.parse({ subject: "x".repeat(200), body: "there" }).subject)
      .toHaveLength(200);
  });
});

describe("actionPlanSchema", () => {
  const gmailDraft = {
    type: "gmail_draft", confidence: "high", rationale: "The client expects a confirmation.",
    required_data: ["recipient", "subject", "body"], missing_data: ["recipient"],
  };

  it("accepts zero actions and multiple distinct, supported actions", () => {
    expect(actionPlanSchema.parse({ actions: [] }).actions).toEqual([]);
    expect(actionPlanSchema.parse({ actions: [gmailDraft, {
      type: "internal_task", confidence: "medium", rationale: "The work needs tracking.",
      required_data: ["task_title", "owner"], missing_data: [],
    }] }).actions).toHaveLength(2);
  });

  it("refuses duplicate action types and missing data outside the requirements", () => {
    expect(() => actionPlanSchema.parse({ actions: [gmailDraft, gmailDraft] })).toThrow();
    expect(() => actionPlanSchema.parse({ actions: [{
      ...gmailDraft, missing_data: ["start_time"],
    }] })).toThrow();
  });
});
