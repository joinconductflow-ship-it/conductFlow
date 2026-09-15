import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/google/tokens";
import { sealRefreshToken } from "@/lib/google/vault";
import { logFailure } from "@/lib/observability/log";

vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));

const DRIVE = "https://www.googleapis.com/auth/drive.file";

beforeEach(() => {
  vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 8).toString("base64"));
  vi.stubEnv("DATA_SOURCE_KEK_PREVIOUS", "");
  vi.mocked(logFailure).mockClear();
});

function database(row: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    update: vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch);
      return query;
    }),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
  };
  return {
    db: { from: vi.fn(() => query) } as unknown as SupabaseClient,
    updates,
    query,
  };
}

describe("Google credential reconnect state", () => {
  it("scopes watcher credentials to the exact leased connection", async () => {
    const { db, query } = database({ id: "c", state: "revoked" });
    await expect(getAccessToken(db, "org", DRIVE, { connectionId: "c" })).rejects.toMatchObject({ reason: "revoked" });
    expect(query.eq).toHaveBeenCalledWith("id", "c");
    expect(query.eq).toHaveBeenCalledWith("org_id", "org");
  });
  it("classifies a permanently refused refresh as reconnect, retaining transient failures as retryable", async () => {
    const sealed = sealRefreshToken("refresh", "org:google:account");
    for (const permanent of [true, false]) {
      const { db, updates } = database({ id: `refresh-${permanent}`, org_id: "org", provider: "google",
        external_account_id: "account", scopes: [DRIVE], state: "active", token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed });
      const fetchImpl = vi.fn().mockResolvedValue(Response.json({ error: permanent ? "invalid_grant" : "temporarily_unavailable" }, { status: permanent ? 400 : 503 }));
      await expect(getAccessToken(db, "org", DRIVE, { fetchImpl })).rejects.toMatchObject({ reason: permanent ? "reconnect" : "refused" });
      expect(updates.some((u) => u.state === "error")).toBe(permanent);
    }
  });
  it("marks a key-mismatched credential errored without calling Google", async () => {
    const sealed = sealRefreshToken("refresh", "org:google:account", {
      kek: Buffer.alloc(32, 7),
    });
    const { db, updates } = database({
      id: "google-connection",
      org_id: "org",
      provider: "google",
      external_account_id: "account",
      scopes: [DRIVE],
      state: "active",
      token_sealed: sealed.tokenSealed,
      dek_sealed: sealed.dekSealed,
    });

    await expect(getAccessToken(db, "org", DRIVE, {
      fetchImpl: vi.fn(),
    })).rejects.toMatchObject({ reason: "reconnect" });
    expect(updates).toContainEqual(expect.objectContaining({
      state: "error",
      last_error: "credential_decryption_failed",
    }));
    expect(vi.mocked(logFailure)).toHaveBeenCalledWith("Google credential decrypt", expect.objectContaining({
      provider: "google",
      operation: "decrypt_refresh_token",
      orgId: "org",
      dataSourceId: "google-connection",
    }));
  });
});
