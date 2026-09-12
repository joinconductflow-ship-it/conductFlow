import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bootstrapUser } from "@/lib/auth/bootstrap";

import * as audit from "@/lib/audit/log";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const seededOwner = "00000000-0000-0000-0000-0000000000a1";
const seededOrg = "00000000-0000-0000-0000-00000000000a";

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

describe("bootstrapUser", () => {
  it("gives a brand-new user their own org as owner", async () => {
    const id = randomUUID();
    const r = await bootstrapUser(db, { id, termsAccepted: true, email: "ana@example.test", fullName: "Ana Ruiz" });
    expect(r.created).toBe(true);

    const { data: membership } = await db.from("membership")
      .select("role,org_id").eq("user_id", id).single();
    expect(membership!.role).toBe("owner");
    expect(membership!.org_id).toBe(r.orgId);

    const { data: org } = await db.from("organization").select("name").eq("id", r.orgId).single();
    expect(org!.name).toBe("Ana Ruiz's workspace");
  });

  it("names the org from the email when Google sent no display name", async () => {
    const id = randomUUID();
    const r = await bootstrapUser(db, { id, termsAccepted: true, email: "solo@example.test", fullName: null });
    const { data: org } = await db.from("organization").select("name").eq("id", r.orgId).single();
    expect(org!.name).toBe("solo's workspace");
  });

  it("mirrors the user into app_user with an acceptance timestamp", async () => {
    const id = randomUUID();
    const started = Date.now();
    await bootstrapUser(db, { id, termsAccepted: true, email: "mirror@example.test" });
    const { data } = await db.from("app_user").select("email,terms_accepted_at").eq("id", id).single();
    expect(data!.email).toBe("mirror@example.test");
    const acceptedAt = Date.parse(data!.terms_accepted_at);
    expect(acceptedAt).toBeGreaterThanOrEqual(started);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now());
  });

  it("is idempotent — a second sign-in does not create a second org", async () => {
    const id = randomUUID();
    const first = await bootstrapUser(db, { id, termsAccepted: true, email: "twice@example.test" });
    const { data: before } = await db.from("app_user")
      .select("terms_accepted_at").eq("id", id).single();
    const second = await bootstrapUser(db, { id, email: "twice@example.test" });
    const { data: after } = await db.from("app_user")
      .select("terms_accepted_at").eq("id", id).single();
    expect(after!.terms_accepted_at).toBe(before!.terms_accepted_at);
    expect(second.created).toBe(false);
    expect(second.orgId).toBe(first.orgId);

    const { data } = await db.from("membership").select("id").eq("user_id", id);
    expect(data!).toHaveLength(1);
  });

  it("leaves an existing member in their current org", async () => {
    const r = await bootstrapUser(db, { id: seededOwner, email: "owner@demo.test" });
    expect(r.created).toBe(false);
    expect(r.orgId).toBe(seededOrg);
  });

  it("writes an audit row for the org it created", async () => {
    const id = randomUUID();
    const r = await bootstrapUser(db, { id, termsAccepted: true, email: "audited@example.test" });
    const { data } = await db.from("audit_event").select("*")
      .eq("target", `organization:${r.orgId}:bootstrap`);
    expect(data!).toHaveLength(1);
    expect(data![0].actor).toBe("human");
    expect(data![0].action).toBe("create");
  });
});

// These checks run without a local Supabase instance so consent enforcement remains testable.
describe("bootstrapUser consent enforcement", () => {
  function client(existing: { org_id: string } | null = null) {
    const lookup = vi.fn().mockResolvedValue({ data: existing, error: null });
    const membership = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(), maybeSingle: lookup,
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    const appUser = { upsert: vi.fn().mockResolvedValue({ error: null }) };
    const organization = {
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "org-1" }, error: null }),
    };
    const from = vi.fn((table: string) => {
      if (table === "membership") return membership;
      if (table === "app_user") return appUser;
      if (table === "organization") return organization;
      throw new Error(`Unexpected table: ${table}`);
    });
    return { db: { from } as unknown as SupabaseClient, from, lookup, appUser, organization };
  }

  it.each([undefined, false])("rejects a new user with acceptance %s before any writes", async (termsAccepted) => {
    const mock = client();
    await expect(bootstrapUser(mock.db, { id: "new-user", email: "new@example.test", termsAccepted }))
      .rejects.toThrow("You must accept the Privacy Policy and Terms to continue.");
    expect(mock.from).toHaveBeenCalledTimes(1);
    expect(mock.appUser.upsert).not.toHaveBeenCalled();
    expect(mock.organization.insert).not.toHaveBeenCalled();
  });

  it("records first acceptance and skips all writes on a later sign-in without acceptance", async () => {
    const mock = client();
    const log = vi.spyOn(audit, "logAudit").mockResolvedValue(undefined);
    try {
      const started = Date.now();
      await bootstrapUser(mock.db, { id: "new-user", email: "new@example.test", termsAccepted: true });
      const record = mock.appUser.upsert.mock.calls[0][0];
      expect(Date.parse(record.terms_accepted_at)).toBeGreaterThanOrEqual(started);
      expect(Date.parse(record.terms_accepted_at)).toBeLessThanOrEqual(Date.now());
      expect(mock.appUser.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: "new-user" }),
        { onConflict: "id", ignoreDuplicates: true });
      mock.lookup.mockResolvedValue({ data: { org_id: "org-1" }, error: null });
      expect(await bootstrapUser(mock.db, { id: "new-user", email: "new@example.test" }))
        .toEqual({ orgId: "org-1", created: false });
      expect(mock.appUser.upsert).toHaveBeenCalledTimes(1);
      expect(mock.organization.insert).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
