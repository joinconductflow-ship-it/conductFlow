import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  markUnmatchedSourceLinked,
  normalizeUnmatchedSourceKey,
  recordUnmatchedSource,
  escapeClientSearch,
  truncateUnmatchedSourceText,
} from "@/lib/integrations/unmatched";

function fakeDb(options: { existing?: { id: string; occurrence_count: number } | null } = {}) {
  const calls: Array<{ method: string; value?: unknown }> = [];
  let lookupCount = 0;
  const db = {
    rpc: async (_name: string, value: unknown) => { calls.push({ method: "rpc", value }); return { data: !options.existing, error: null }; },
    from() {
      const builder: Record<string, (...args: unknown[]) => unknown> = {
        select: (...args) => { calls.push({ method: "select", value: args[0] }); return builder; },
        eq: (...args) => { calls.push({ method: "eq", value: args }); return builder; },
        maybeSingle: async () => {
          lookupCount++;
          return { data: lookupCount === 1 ? (options.existing ?? null) : null, error: null };
        },
        update: (value) => { calls.push({ method: "update", value }); return builder; },
        insert: (value) => { calls.push({ method: "insert", value }); return builder; },
        then: (...args) => (args[0] as (value: unknown) => unknown)({ error: null }),
      };
      return builder;
    },
    calls,
  };
  return db as unknown as SupabaseClient & { calls: typeof calls };
}

describe("unmatched integration sources", () => {
  it("normalizes email keys and bounds display text", () => {
    expect(normalizeUnmatchedSourceKey("email", "  Person@Example.COM ")).toBe("person@example.com");
    expect(normalizeUnmatchedSourceKey("channel", " C123 ")).toBe("C123");
    expect(truncateUnmatchedSourceText("  hello  ")).toBe("hello");
    expect(truncateUnmatchedSourceText("x".repeat(300))).toHaveLength(240);
    expect(truncateUnmatchedSourceText("   ")).toBeNull();
  });

  it("escapes wildcard characters in client search values", () => {
    expect(escapeClientSearch("100%_ready\\now")).toBe("100\\%\\_ready\\\\now");
  });

  it("creates one aggregated review row for a new source", async () => {
    const db = fakeDb();
    await recordUnmatchedSource(db, {
      orgId: "org-1", provider: "google", sourceType: "email",
      sourceKey: "  PERSON@EXAMPLE.COM ", sourceName: "Person Example", sourceLabel: "Question",
      connectedDataSourceId: "connection-1",
    });
    const inserted = db.calls.find((call) => call.method === "rpc")?.value as Record<string, unknown>;
    expect(inserted).toMatchObject({
      p_org: "org-1", p_provider: "google", p_type: "email", p_key: "person@example.com",
      p_name: "Person Example", p_label: "Question",
    });
  });

  it("increments an existing source without reopening its status", async () => {
    const db = fakeDb({ existing: { id: "source-1", occurrence_count: 4 } });
    const opened = await recordUnmatchedSource(db, {
      orgId: "org-1", provider: "slack", sourceType: "channel",
      sourceKey: "C123", sourceName: "#client", sourceLabel: "Public Slack channel",
    });
    expect(opened).toBe(false);
    expect(db.calls.map((c) => c.method)).toEqual(["rpc"]);
  });

  it("marks a source linked to a client", async () => {
    const db = fakeDb();
    await markUnmatchedSourceLinked(db, {
      orgId: "org-1", provider: "google", sourceType: "email",
      sourceKey: " Person@Example.com ", clientContactId: "client-1",
    });
    const update = db.calls.find((call) => call.method === "update")?.value as Record<string, unknown>;
    expect(update).toMatchObject({ status: "linked", client_contact_id: "client-1" });
    expect(db.calls).toContainEqual({ method: "eq", value: ["status", "open"] });
    expect(db.calls).toContainEqual({ method: "eq", value: ["org_id", "org-1"] });
  });
});
