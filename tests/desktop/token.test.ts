import { describe, it, expect } from "vitest";
import {
  generateToken, hashToken, looksLikeToken, resolveToken,
} from "@/lib/auth/desktop-token";

/**
 * Pure-function coverage for desktop tokens. The stack-backed half — a token from
 * org A resolving against org B — lives in rls.test.ts, which has a live database.
 */

/** Minimal stand-in for the one query resolveToken makes. */
function fakeDb(row: unknown, error: { message: string } | null = null) {
  return {
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: row, error }),
  } as never;
}

describe("token generation", () => {
  it("carries a recognisable prefix and enough entropy", () => {
    const token = generateToken();
    expect(token.startsWith("cfd_")).toBe(true);
    expect(token.length).toBeGreaterThan(40);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(seen.size).toBe(500);
  });

  it("hashes deterministically, and the hash is not the token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it("rejects malformed shapes before any lookup", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("cfd_")).toBe(false);
    expect(looksLikeToken("cfd_short")).toBe(false);
    expect(looksLikeToken("sk-proj-somethingelseentirely")).toBe(false);
    expect(looksLikeToken(generateToken())).toBe(true);
  });
});

describe("resolveToken", () => {
  const token = generateToken();
  const row = {
    id: "tok-1", org_id: "org-a", user_id: "user-1",
    token_hash: hashToken(token), revoked_at: null,
  };

  it("resolves a live token to its org and user", async () => {
    const result = await resolveToken(fakeDb(row), `Bearer ${token}`);
    expect(result).toEqual({ tokenId: "tok-1", orgId: "org-a", userId: "user-1" });
  });

  it("refuses a revoked token", async () => {
    const revoked = { ...row, revoked_at: new Date().toISOString() };
    expect(await resolveToken(fakeDb(revoked), `Bearer ${token}`)).toBeNull();
  });

  it("refuses an unknown token", async () => {
    expect(await resolveToken(fakeDb(null), `Bearer ${generateToken()}`)).toBeNull();
  });

  it("refuses a missing or malformed header", async () => {
    for (const header of [null, "", "Basic abc", token, `Bearer ${""}`, "Bearer cfd_x"]) {
      expect(await resolveToken(fakeDb(row), header)).toBeNull();
    }
  });

  it("treats a lookup error as a denial, not as 'not found'", async () => {
    // A database that is refusing reads must never silently authorise a caller.
    await expect(
      resolveToken(fakeDb(null, { message: "connection reset" }), `Bearer ${token}`),
    ).rejects.toThrow(/lookup failed/);
  });

  it("does not authorise when the stored hash disagrees with the token", async () => {
    // Guards a future change that relaxes the unique index on token_hash.
    const mismatched = { ...row, token_hash: hashToken(generateToken()) };
    expect(await resolveToken(fakeDb(mismatched), `Bearer ${token}`)).toBeNull();
  });
});
