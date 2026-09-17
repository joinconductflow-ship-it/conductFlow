import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrMintExtensionToken, hashToken } from "@/lib/auth/desktop-token";

interface Row {
  id: string; org_id: string; user_id: string; label: string; token_hash: string; revoked_at: string | null;
}
function database(options: { race?: boolean; insertError?: { code: string; message: string } } = {}) {
  const rows: Row[] = [];
  const inserts = vi.fn();
  const from = vi.fn((table: string) => {
    expect(table).toBe("desktop_token");
    const filters: Record<string, unknown> = {};
    let incoming: Omit<Row, "id" | "revoked_at">;
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return query; }),
      is: vi.fn((key: string, value: unknown) => { filters[key] = value; return query; }),
      maybeSingle: vi.fn(async () => ({
        data: rows.find((row) => Object.entries(filters).every(([key, value]) => row[key as keyof Row] === value)) ?? null,
        error: null,
      })),
      insert: vi.fn((row: typeof incoming) => { incoming = row; inserts(row); return query; }),
      single: vi.fn(async () => {
        if (options.insertError) return { data: null, error: options.insertError };
        if (options.race) {
          rows.push({ ...incoming, id: "race-winner", token_hash: hashToken("winner-private-token"), revoked_at: null });
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { ...incoming, id: `token-${rows.length + 1}`, revoked_at: null };
        rows.push(row);
        return { data: { id: row.id }, error: null };
      }),
    };
    return query;
  });
  return { db: { from } as unknown as SupabaseClient, rows, inserts };
}
const ARGS = { orgId: "org", userId: "user" };

describe("findOrMintExtensionToken", () => {
  it("mints once, stores only a hash, and returns plaintext only to the first caller", async () => {
    const { db, rows, inserts } = database();
    const first = await findOrMintExtensionToken(db, ARGS);
    expect(first.token).toMatch(/^cfd_/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ org_id: "org", user_id: "user", label: "Chrome extension (auto)",
      token_hash: hashToken(first.token!) });
    expect(JSON.stringify(rows)).not.toContain(first.token);
    expect(await findOrMintExtensionToken(db, ARGS)).toEqual({ token: null, id: first.id });
    expect(rows).toHaveLength(1);
    expect(inserts).toHaveBeenCalledTimes(1);
  });
  it("returns the winning row without the losing insert's plaintext after a unique violation", async () => {
    const { db, rows, inserts } = database({ race: true });
    expect(await findOrMintExtensionToken(db, ARGS)).toEqual({ token: null, id: "race-winner" });
    expect(rows).toHaveLength(1);
    expect(inserts).toHaveBeenCalledTimes(1);
    expect(rows[0].token_hash).not.toBe(inserts.mock.calls[0][0].token_hash);
  });
  it("mints a replacement after revocation and scopes reuse to the org and user", async () => {
    const { db, rows } = database();
    await findOrMintExtensionToken(db, ARGS);
    rows[0].revoked_at = "2026-09-17T00:00:00Z";
    const replacement = await findOrMintExtensionToken(db, ARGS);
    expect(replacement.token).toMatch(/^cfd_/);
    await findOrMintExtensionToken(db, { ...ARGS, orgId: "other-org" });
    await findOrMintExtensionToken(db, { ...ARGS, userId: "other-user" });
    expect(rows).toHaveLength(4);
  });
  it("does not swallow unrelated insert failures", async () => {
    const { db } = database({ insertError: { code: "08006", message: "connection failed" } });
    await expect(findOrMintExtensionToken(db, ARGS)).rejects.toThrow("connection failed");
  });
  it("does not invent a winner when a unique violation has no matching row", async () => {
    const { db } = database({ insertError: { code: "23505", message: "hash collision" } });
    await expect(findOrMintExtensionToken(db, ARGS)).rejects.toThrow("hash collision");
  });
});
