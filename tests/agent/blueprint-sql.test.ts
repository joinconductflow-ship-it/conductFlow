import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HARD_PROHIBITED, ALWAYS_NEEDS_APPROVAL } from "@/lib/agent/blueprint";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/0011_blueprint_owner_only.sql"), "utf8");
const executionMigration = readFileSync(
  join(root, "supabase/migrations/20260912045407_google_action_execution.sql"), "utf8");

/** Every quoted string inside the first array[...] following a marker. */
function arrayAfter(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const open = sql.indexOf("array[", start);
  const close = sql.indexOf("]", open);
  return [...sql.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("migration 0011 agrees with lib/agent/blueprint.ts", () => {
  it("the prohibited array matches HARD_PROHIBITED", () => {
    expect(arrayAfter(migration, "agent_blueprint_no_prohibited"))
      .toEqual([...HARD_PROHIBITED]);
  });

  it("the unattended-external array matches ALWAYS_NEEDS_APPROVAL", () => {
    // The current constraint lives in the execution migration, which amends the one 0011
    // shipped. Asserting the latest definition is what keeps the DB and the code in step.
    expect(arrayAfter(executionMigration, "agent_blueprint_no_unattended_external"))
      .toEqual([...ALWAYS_NEEDS_APPROVAL]);
  });

  it("the insert policy is owner-scoped", () => {
    expect(migration).toContain("current_user_owner_orgs()");
    expect(migration).not.toMatch(
      /create policy ins_agent_blueprint[\s\S]*?current_user_orgs\(\)/);
  });
});
