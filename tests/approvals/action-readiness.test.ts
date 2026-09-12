import { describe, expect, it } from "vitest";
import { actionReadiness, initialActionData } from "@/lib/approvals/action-readiness";
import type { Commitment, CommitmentActionSuggestion } from "@/lib/types";

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
