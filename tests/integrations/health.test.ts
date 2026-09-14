import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionHealth } from "@/lib/integrations/health-server";
import { failureHealth, storedHealth } from "@/lib/integrations/health";
import { getServiceClient } from "@/lib/db/service";
import { sealRefreshToken } from "@/lib/google/vault";
import { logFailure } from "@/lib/observability/log";

vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));

type Row = Record<string, unknown>;
let rows: Row[];
const eq = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("DATA_SOURCE_KEK_PREVIOUS", "");
  rows = [];
  const query = {
    select: vi.fn(() => query), in: vi.fn(() => query),
    eq: vi.fn((key, value) => { eq(key, value); return query; }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: rows.filter((row) => row.org_id === "org"), error: null,
    }).then(resolve),
  };
  vi.mocked(getServiceClient).mockReturnValue({ from: () => query } as never);
});
afterEach(() => { vi.unstubAllEnvs(); });

function connection(provider = "slack") {
  const token = provider === "slack" ? "xoxb-test-credential" : "google-refresh-test";
  const sealed = sealRefreshToken(token, `org:${provider}:account`);
  return { id: provider, org_id: "org", provider, external_account_id: "account",
    state: "active", last_error: null, token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed };
}

describe("integration health", () => {
  it("row plus usable credential is Connected, without provider API requests", async () => {
    rows = [connection(), connection("google")];
    expect(await connectionHealth("org")).toEqual({ slack: "connected", google: "connected" });
    expect(eq).toHaveBeenCalledWith("org_id", "org");
  });

  it("old-key credentials are Needs reconnect for both providers and diagnostic-only", async () => {
    rows = [connection(), connection("google")];
    vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 8).toString("base64"));
    const health = await connectionHealth("org");
    expect(health).toEqual({ slack: "needs_reconnect", google: "needs_reconnect" });
    expect(JSON.stringify(health)).not.toMatch(/credential|decrypt|sealed/i);
    expect(logFailure).toHaveBeenCalledWith("Settings credential health", expect.objectContaining({
      provider: "slack", error: expect.objectContaining({ name: "CredentialDecryptionError" }),
    }));
  });

  it("configuration failure is Connection issue, not a futile OAuth reconnect", async () => {
    rows = [connection()];
    vi.stubEnv("DATA_SOURCE_KEK", "");
    expect(await connectionHealth("org")).toEqual({ slack: "connection_issue" });
  });

  it("successful fresh reconnect clears old health and works under the current key", async () => {
    rows = [connection()];
    vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 8).toString("base64"));
    expect((await connectionHealth("org")).slack).toBe("needs_reconnect");
    rows = [connection()]; // Same provider/account id, fresh sealed credential and cleared error.
    expect((await connectionHealth("org")).slack).toBe("connected");
  });

  it("never returns another org's credential health", async () => {
    rows = [connection(), { ...connection("google"), org_id: "other" }];
    expect(await connectionHealth("org")).toEqual({ slack: "connected" });
  });

  it.each(["invalid_grant", "invalid_auth", "token_revoked", "credential_decryption_failed", "reconnect_required",
    "calendar insert failed (403): Request had insufficient authentication scopes.",
    "Token has been expired or revoked."])("stored %s is Needs reconnect", (last_error) => {
    expect(storedHealth({ state: "error", last_error })).toBe("needs_reconnect");
  });

  it("transient provider errors are Connection issue; missing row state is Not connected", () => {
    expect(failureHealth(new Error("Slack HTTP 503 timeout"))).toBe("connection_issue");
    expect(storedHealth({ state: "error", last_error: "Slack HTTP 503" })).toBe("connection_issue");
    expect(storedHealth({ state: "pending" })).toBe("not_connected");
    expect(storedHealth({ state: "revoked" })).toBe("needs_reconnect");
  });
});
