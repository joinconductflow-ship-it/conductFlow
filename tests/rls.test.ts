import { it, expect } from "vitest";
import { describeWithLocalDb } from "./helpers/local-supabase";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const URL = process.env.SUPABASE_URL!, ANON = process.env.SUPABASE_ANON_KEY!,
  SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const orgA = "00000000-0000-0000-0000-00000000000a";
const userA = "00000000-0000-0000-0000-0000000000a1";
const memberA = "00000000-0000-0000-0000-0000000000a2";
const userB = "00000000-0000-0000-0000-0000000000b1";

async function jwt(sub: string) {
  return new SignJWT({ sub, role: "authenticated" }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("1h").sign(SECRET);
}
function client(token: string) {
  return createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

describeWithLocalDb("RLS org isolation", () => {
  it("positive control: org A owner can read org A commitments", async () => {
    const a = client(await jwt(userA));
    const { data } = await a.from("commitment").select("id").eq("org_id", orgA);
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("user in org B cannot read org A commitments", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("commitment").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("anonymous callers are denied outright", async () => {
    const anon = createClient(URL, ANON);
    const { data, error } = await anon.from("commitment").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("user in org B cannot read org A transcripts", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("transcript").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A reminders", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("reminder").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A tasks", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("task").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("no role may delete a task — the record of a promise is not erasable", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("task").delete().eq("org_id", orgA);
    expect(error).not.toBeNull();
  });

  it("a signed-in owner cannot read the connected_data_source table at all", async () => {
    const a = client(await jwt(userA));
    const { data, error } = await a.from("connected_data_source").select("token_sealed");
    expect(data).toBeNull();
    // Granted to service_role only: key and ciphertext never share a trust context.
    expect(error?.code).toBe("42501");
  });

  it("an owner reads their connections through the view, which exposes no sealed material", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("connected_data_source_public").select("account_email,scopes,state");
    expect(error).toBeNull();

    const sealed = await a.from("connected_data_source_public").select("token_sealed");
    expect(sealed.error).not.toBeNull();
  });

  it("org A owner sees the phase 2 columns with their defaults", async () => {
    const a = client(await jwt(userA));
    const { data } = await a.from("transcript")
      .select("injection_flags,extraction_status,extraction_error").eq("org_id", orgA).limit(1);
    expect(data).not.toBeNull();
    expect(data![0].extraction_status).toBe("pending");
    expect(data![0].injection_flags).toEqual([]);
  });
});

describeWithLocalDb("agent_blueprint is owner-only", () => {
  // The escalation this phase exists to close: a member rewrites the org's contract
  // through PostgREST, granting the agent an unattended Gmail push.
  it("a member cannot insert a blueprint row", async () => {
    const m = client(await jwt(memberA));
    const { error } = await m.from("agent_blueprint").insert({
      org_id: orgA, version: 9001,
      allowed_sources: ["transcript"],
      permitted_actions: ["push_email_draft"],
      required_approvals: [],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("an owner can insert a blueprint row", async () => {
    const a = client(await jwt(userA));
    // Blueprints are append-only and nothing in this suite deletes, so a fixed version
    // number would collide with itself (23505) the second time the suite runs against a
    // database that was not reset. Claim the next free version at or above 9002 instead.
    const { data: highest } = await a.from("agent_blueprint").select("version")
      .eq("org_id", orgA).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = Math.max(9002, ((highest?.version as number | undefined) ?? 0) + 1);

    // Contents are deliberately identical to DEFAULT_BLUEPRINT. This row wins
    // loadBlueprint's ordering for org A from here on, and the suite never deletes, so
    // anything else would silently change what later stack-backed tests are allowed
    // to do. See the version-range note in the Phase 5 plan, Task 2.
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version,
      allowed_sources: ["transcript", "client_contact", "template"],
      permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up"],
      required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
        "propose_recurring_task"],
      escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).toBeNull();
  });

  it("not even an owner may grant an unattended external action", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9003,
      allowed_sources: ["transcript"],
      permitted_actions: ["push_email_draft"],
      required_approvals: [],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("not even an owner may name a hard-prohibited action", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9004,
      allowed_sources: ["transcript"],
      permitted_actions: ["draft_recap"],
      required_approvals: ["send_external_email"],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("user in org B cannot read org A blueprints", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("agent_blueprint").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A escalations", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("escalation").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });
});

describeWithLocalDb("audit_event is append-only", () => {
  it("an org member can insert and read audit rows", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("audit_event").insert({
      org_id: orgA, actor: "human", action: "read", target: "test:append-only" });
    expect(error).toBeNull();
  });

  it("no role may delete or update audit rows", async () => {
    const a = client(await jwt(userA));
    const del = await a.from("audit_event").delete().eq("org_id", orgA);
    expect(del.error).not.toBeNull();
    const upd = await a.from("audit_event").update({ target: "tampered" }).eq("org_id", orgA);
    expect(upd.error).not.toBeNull();
  });
});
