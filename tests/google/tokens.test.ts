import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getAccessToken, storeGrant, clearTokenCache, DataSourceUnavailable,
} from "@/lib/google/tokens";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const orgA = "00000000-0000-0000-0000-00000000000a";
const ownerA = "00000000-0000-0000-0000-0000000000a1";
const DRIVE = "https://www.googleapis.com/auth/drive.file";

process.env.DATA_SOURCE_KEK = randomBytes(32).toString("base64");

let db: SupabaseClient;

function respondingWith(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  })) as unknown as typeof fetch;
}

async function connect(scopes = [DRIVE]) {
  return storeGrant(db, {
    orgId: orgA, accountEmail: "owner@demo.test", externalAccountId: "sub-123",
    refreshToken: "1//the-refresh-token", scopes, connectedBy: ownerA,
  });
}

beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });
beforeEach(async () => {
  clearTokenCache();
  await db.from("connected_data_source").update({ state: "revoked" }).eq("org_id", orgA);
});

describe("storeGrant", () => {
  it("stores the refresh token sealed, never in the clear", async () => {
    const id = await connect();
    const { data } = await db.from("connected_data_source").select("*").eq("id", id).single();
    expect(data!.token_sealed).not.toContain("the-refresh-token");
    expect(data!.dek_sealed).not.toBe(data!.token_sealed);
    expect(data!.state).toBe("active");
    expect(data!.scopes).toEqual([DRIVE]);
  });

  it("records the scopes Google granted, not the ones asked for", async () => {
    const id = await connect([DRIVE]);
    const { data } = await db.from("connected_data_source").select("scopes").eq("id", id).single();
    expect(data!.scopes).toEqual([DRIVE]);
  });

  it("writes a connect audit row", async () => {
    const id = await connect();
    const { data } = await db.from("audit_event").select("*")
      .eq("target", `data_source:${id}:connect`);
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].actor).toBe("human");
  });
});

describe("getAccessToken", () => {
  it("refreshes and returns an access token", async () => {
    await connect();
    const token = await getAccessToken(db, orgA, DRIVE, {
      fetchImpl: respondingWith({ access_token: "ya29.fresh", expires_in: 3600 }),
    });
    expect(token).toBe("ya29.fresh");
  });

  it("reuses the cached token instead of refreshing again", async () => {
    await connect();
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response(JSON.stringify({ access_token: "ya29.cached", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await getAccessToken(db, orgA, DRIVE, { fetchImpl: counting });
    await getAccessToken(db, orgA, DRIVE, { fetchImpl: counting });
    expect(calls).toBe(1);
  });

  it("refreshes again once the cached token is near expiry", async () => {
    await connect();
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response(JSON.stringify({ access_token: "ya29.short", expires_in: 30 }),
        { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    await getAccessToken(db, orgA, DRIVE, { fetchImpl: counting });
    await getAccessToken(db, orgA, DRIVE, { fetchImpl: counting });
    expect(calls).toBe(2);
  });

  it("refuses a scope the user never granted", async () => {
    await connect([DRIVE]);
    await expect(getAccessToken(db, orgA, "https://www.googleapis.com/auth/gmail.compose", {
      fetchImpl: respondingWith({ access_token: "ya29.x", expires_in: 3600 }),
    })).rejects.toThrow(/did not grant/i);
  });

  it("reports a missing connection rather than returning nothing", async () => {
    await expect(getAccessToken(db, "00000000-0000-0000-0000-00000000000b", DRIVE, {
      fetchImpl: respondingWith({}),
    })).rejects.toBeInstanceOf(DataSourceUnavailable);
  });

  it("marks the row errored when Google refuses the refresh", async () => {
    const id = await connect();
    await expect(getAccessToken(db, orgA, DRIVE, {
      fetchImpl: respondingWith({ error: "invalid_grant" }, 400),
    })).rejects.toThrow(/invalid_grant/);

    const { data } = await db.from("connected_data_source").select("state,last_error")
      .eq("id", id).single();
    expect(data!.state).toBe("error");
    expect(data!.last_error).toMatch(/invalid_grant/);
  });

  it("marks a key-mismatched credential as reconnect-required", async () => {
    const id = await connect();
    const original = process.env.DATA_SOURCE_KEK;
    process.env.DATA_SOURCE_KEK = randomBytes(32).toString("base64");
    try {
      await expect(getAccessToken(db, orgA, DRIVE, {
        fetchImpl: respondingWith({ access_token: "should-not-be-called", expires_in: 3600 }),
      })).rejects.toMatchObject({ reason: "reconnect" });
      const { data } = await db.from("connected_data_source").select("state,last_error")
        .eq("id", id).single();
      expect(data!.state).toBe("error");
      expect(data!.last_error).toBe("credential_decryption_failed");
    } finally {
      process.env.DATA_SOURCE_KEK = original;
    }
  });

  it("audits every token use", async () => {
    const id = await connect();
    await getAccessToken(db, orgA, DRIVE, {
      fetchImpl: respondingWith({ access_token: "ya29.audited", expires_in: 3600 }),
    });
    const { data } = await db.from("audit_event").select("*")
      .eq("target", `data_source:${id}:${DRIVE}`);
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].actor).toBe("agent");
    expect(data![0].action).toBe("read");
  });
});
