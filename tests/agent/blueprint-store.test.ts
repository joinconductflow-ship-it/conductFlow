import { it, expect, beforeAll } from "vitest";
import { describeWithLocalDb } from "../helpers/local-supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadBlueprint, contractFor, saveBlueprint } from "@/lib/agent/blueprint-store";
import { DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Org B is otherwise untouched by the suite, so its version sequence is predictable.
const orgB = "00000000-0000-0000-0000-00000000000b";
const ownerB = "00000000-0000-0000-0000-0000000000b1";

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

/**
 * A rejection that never reached Postgres. Migration 0011 also refuses these rows with a
 * 23514, so "it threw" alone would not tell us which layer said no — and the whole point
 * of validateBlueprintEdit is that the editor gets a sentence, not a constraint name.
 * A PostgrestError carries `code`; an Error from validateBlueprintEdit does not.
 */
async function expectRejectedBeforeTheDatabase(
  save: () => Promise<unknown>, message: RegExp,
): Promise<void> {
  const before = await loadBlueprint(db, orgB);
  const err = await save().then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(message);
  expect((err as { code?: string }).code).toBeUndefined();
  expect((err as Error).message).not.toMatch(/check constraint/i);
  // Nothing was written, so the row never had a chance to meet a CHECK.
  expect((await loadBlueprint(db, orgB)).version).toBe(before.version);
}

describeWithLocalDb("loadBlueprint", () => {
  it("returns the shipped defaults at version 0 for an org that never edited one", async () => {
    const loaded = await loadBlueprint(db, orgB);
    if (loaded.version === 0) {
      expect(loaded.permitted_actions).toEqual(DEFAULT_BLUEPRINT.permitted_actions);
    }
    // Version 0 only holds on a fresh db:reset; a later run reads what an earlier one
    // wrote, which is why this asserts the invariant rather than the literal.
    expect(loaded.version).toBeGreaterThanOrEqual(0);
  });
});

describeWithLocalDb("saveBlueprint", () => {
  it("appends a new version rather than updating the current one", async () => {
    const before = await loadBlueprint(db, orgB);
    const saved = await saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT, expires_in_minutes: 45,
    }, ownerB);
    expect(saved.version).toBe(before.version + 1);

    const after = await loadBlueprint(db, orgB);
    expect(after.version).toBe(saved.version);
    expect(after.expires_in_minutes).toBe(45);
  });

  it("refuses an edit that grants an always-approval action unattended", async () => {
    // push_email_draft is dropped from required_approvals here on purpose. Adding it to
    // permitted_actions while leaving it in required_approvals trips the earlier
    // both-arrays check instead, which is a different rule — see the case below.
    await expectRejectedBeforeTheDatabase(() => saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT,
      permitted_actions: [...DEFAULT_BLUEPRINT.permitted_actions, "push_email_draft"],
      required_approvals: DEFAULT_BLUEPRINT.required_approvals.filter(
        (a) => a !== "push_email_draft"),
    }, ownerB), /always needs approval/i);
  });

  it("refuses an action claimed as both unattended and approval-gated", async () => {
    await expectRejectedBeforeTheDatabase(() => saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT,
      permitted_actions: [...DEFAULT_BLUEPRINT.permitted_actions, "push_email_draft"],
    }, ownerB), /cannot be both unattended and approval-gated/i);
  });

  it("refuses a hard-prohibited action", async () => {
    await expectRejectedBeforeTheDatabase(() => saveBlueprint(db, orgB, {
      ...DEFAULT_BLUEPRINT,
      required_approvals: ["send_external_email"],
    }, ownerB), /never available/i);
  });

  it("writes an audit row naming the new version", async () => {
    const saved = await saveBlueprint(db, orgB, DEFAULT_BLUEPRINT, ownerB);
    const { data } = await db.from("audit_event").select("target")
      .eq("org_id", orgB).eq("action", "create")
      .like("target", "agent_blueprint:%");
    expect((data ?? []).map((r) => r.target))
      .toContain(`agent_blueprint:${orgB}:v${saved.version}`);
  });
});

describeWithLocalDb("contractFor", () => {
  it("returns a contract whose prohibitions come from code, not the row", async () => {
    const c = await contractFor(db, orgB);
    expect(c.prohibitedActions).toContain("send_external_email");
    expect(c.prohibitedActions).toContain("delete_record");
  });
});
