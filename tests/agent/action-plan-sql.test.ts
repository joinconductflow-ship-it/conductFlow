import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260912031336_action_planning.sql"), "utf8");

describe("action-planning migration", () => {
  it("persists only supported suggested action types", () => {
    expect(migration).toContain("create table commitment_action_suggestion");
    expect(migration).toContain("'gmail_draft', 'calendar_event', 'drive_document', 'internal_task'");
  });

  it("keeps suggestions tenant-scoped and protected by RLS", () => {
    expect(migration).toContain("alter table commitment_action_suggestion enable row level security");
    expect(migration).toContain("current_user_orgs()");
    expect(migration).toContain("grant select, insert, update on commitment_action_suggestion to authenticated, service_role");
  });

  it("deletes planning suggestions with a replaced commitment", () => {
    expect(migration).toContain("references commitment(id) on delete cascade");
  });
});
