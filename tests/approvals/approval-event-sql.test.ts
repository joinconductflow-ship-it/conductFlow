import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Google action execution migration", () => {
  it("atomically prevents duplicate approved action audit rows", () => {
    const sql = readFileSync(join(
      process.cwd(),
      "supabase/migrations/20260912045407_google_action_execution.sql",
    ), "utf8");

    expect(sql).toMatch(/create unique index approval_event_one_action_approval/i);
    expect(sql).toMatch(/on approval_event \(org_id, subject_id\)/i);
    expect(sql).toMatch(/subject_type = 'commitment_action_suggestion'/i);
    expect(sql).toMatch(/state = 'approved'/i);
  });
});
