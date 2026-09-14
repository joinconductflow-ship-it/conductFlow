import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyError,
  presentError,
  presentErrorText,
  UserFacingError,
} from "@/lib/errors/presentation";
import { logFailure } from "@/lib/observability/log";

afterEach(() => vi.restoreAllMocks());

const frameworkMessage =
  "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.";

describe("safe error presentation", () => {
  it("never returns the raw framework message", () => {
    const result = presentError(new Error(frameworkMessage), {
      fallback: "Couldn't load this data right now. Try again.",
    });
    expect(result).toBe("Couldn't load this data right now. Try again.");
    expect(result).not.toContain("Server Components");
  });

  it("maps provider failures to contextual copy", () => {
    const result = presentError(new Error("Slack: invalid_auth"), {
      fallback: "Couldn't load Slack channels. Try again.",
      provider: "Couldn't load Slack channels. Your connection is still active. Try reloading channels.",
    });
    expect(result).toBe("Couldn't load Slack channels. Your connection is still active. Try reloading channels.");
    expect(result).not.toContain("invalid_auth");
  });

  it("maps credential decryption failures to reconnect guidance", () => {
    expect(classifyError(new Error("Stored refresh token could not be decrypted with any configured key.")))
      .toEqual({ kind: "reconnect" });
    expect(presentError(new Error("Stored refresh token could not be decrypted with any configured key."), {
      fallback: "Try again.",
      provider: "Provider unavailable.",
      reconnect: "Reconnect Google before continuing.",
    })).toBe("Reconnect Google before continuing.");
  });

  it("keeps authentication fail-closed while giving safe copy", () => {
    expect(classifyError(new Error("Workspace access denied."))).toEqual({ kind: "authentication" });
    expect(presentError(new Error("Workspace access denied."), {
      fallback: "Couldn't load this data right now. Try again.",
      authentication: "Please sign in again.",
    })).toBe("Please sign in again.");
  });

  it("allows explicitly authored validation messages", () => {
    expect(presentError(new UserFacingError("Choose a client in your workspace."), {
      fallback: "Couldn't save that change. Try again.",
    })).toBe("Choose a client in your workspace.");
  });

  it("sanitizes query-string errors at the page boundary", () => {
    expect(presentErrorText("PGRST204: column token_sealed does not exist", {
      fallback: "Couldn't load settings. Try again.",
    })).toBe("Couldn't load settings. Try again.");
  });
});

describe("diagnostic logging", () => {
  it("keeps technical detail in logs while redacting credential-shaped values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure("slack channels load", {
      provider: "slack",
      operation: "conversations.list",
      transcriptId: "transcript-123",
      error: new Error("request failed with access_token=secret-value"),
    });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("slack channels load");
    expect(line).toContain("request failed");
    expect(line).toContain("transcript-123");
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("secret-value");
  });
});
