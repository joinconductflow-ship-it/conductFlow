import { describe, expect, it } from "vitest";
import { GenerationFailure } from "@/lib/agent/generate";
import { presentDraftFailure } from "@/lib/drafts/failure";
import { DataSourceUnavailable } from "@/lib/google/tokens";

function generationFailure(retryable: boolean): GenerationFailure {
  return new GenerationFailure({
    errorType: "GatewayRateLimitError",
    status: 429,
    retryable,
    operation: "draft",
    actionType: "gmail_draft",
    attempts: 4,
  });
}

describe("presentDraftFailure", () => {
  it("returns a concise rate-limit message for a retryable generation failure", () => {
    const result = presentDraftFailure(generationFailure(true));
    expect(result).toEqual({
      message: "AI drafting is temporarily rate-limited. Try again shortly.",
      rateLimited: true,
    });
  });

  it("does not expose provider payload or stack details", () => {
    const failure = generationFailure(true);
    const serialized = JSON.stringify(presentDraftFailure(failure));
    expect(serialized).not.toContain("requestBodyValues");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("GatewayRateLimitError");
  });

  it("uses a generic message for a non-retryable generation failure", () => {
    expect(presentDraftFailure(generationFailure(false))).toEqual({
      message: "AI drafting failed. Try again shortly.",
      rateLimited: false,
    });
  });

  it("requires reconnecting Google after credential decryption failure", () => {
    expect(presentDraftFailure(new DataSourceUnavailable("private detail", "reconnect"))).toEqual({
      message: "Google needs to be reconnected before ConductFlow can write drafts.",
      reconnectRequired: true,
      rateLimited: false,
    });
  });

  it("passes through an explicitly allow-listed application error", () => {
    expect(presentDraftFailure(new Error("commitment not found"))).toEqual({
      message: "commitment not found",
      rateLimited: false,
    });
    expect(presentDraftFailure(new Error("action denied: draft_follow_up requires approval")))
      .toEqual({
        message: "action denied: draft_follow_up requires approval",
        rateLimited: false,
      });
  });

  it("collapses a raw database/internal error to generic safe copy", () => {
    const dbError = new Error('relation "commitment_action_suggestion" does not exist');
    expect(presentDraftFailure(dbError)).toEqual({
      message: "The draft could not be written. Please try again.",
      rateLimited: false,
    });
  });

  it("collapses an unknown provider-shaped error to generic safe copy", () => {
    expect(presentDraftFailure({ message: "upstream 502", status: 502 })).toEqual({
      message: "The draft could not be written. Please try again.",
      rateLimited: false,
    });
  });
});
