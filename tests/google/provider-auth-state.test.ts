import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleApiError } from "@/lib/google/api-error";
import { recordGoogleApiAuthFailure } from "@/lib/google/tokens";

function connectedSource() {
  const row: Record<string, unknown> = { id: "google-source-1", state: "active", last_error: null };
  const db = {
    from() {
      return {
        select() {
          const query = {
            eq: () => query,
            limit: () => query,
            maybeSingle: async () => ({ data: row, error: null }),
          };
          return query;
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async () => {
              Object.assign(row, patch);
              return { error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, row };
}

describe("recordGoogleApiAuthFailure", () => {
  it("keeps the connection active after a downstream 401 so retry can refresh", async () => {
    const { db, row } = connectedSource();

    await recordGoogleApiAuthFailure(
      db,
      "org-1",
      new GoogleApiError("calendar", "events.list", 401, "expired token"),
    );

    expect(row.state).toBe("active");
    expect(row.last_error).toBeNull();
  });

  it("marks the connection errored when Google reports insufficient scope", async () => {
    const { db, row } = connectedSource();

    await recordGoogleApiAuthFailure(
      db,
      "org-1",
      new GoogleApiError("drive", "files.create", 403, '{"error":{"message":"insufficient authentication scope"}}'),
    );

    expect(row.state).toBe("error");
    expect(row.last_error).toContain("insufficient authentication scope");
  });
});
