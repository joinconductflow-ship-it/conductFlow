import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/slack/connect/callback/route";
import { connectionHealth } from "@/lib/integrations/health-server";
import { getServiceClient } from "@/lib/db/service";
import { openRefreshToken, sealRefreshToken } from "@/lib/google/vault";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({
  value: JSON.stringify({ state: "test-nonce", userId: "user", orgId: "org" }),
}) }) }));
vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: async () => "org", getCurrentUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/http/site-origin", () => ({ siteOrigin: async () => "https://qa.conductflow.test" }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));

let row: Record<string, unknown>;
const upsert = vi.fn();
const from = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("DATA_SOURCE_KEK_PREVIOUS", "");
  vi.stubEnv("SLACK_CLIENT_ID", "qa-client");
  vi.stubEnv("SLACK_CLIENT_SECRET", "qa-secret-fixture");
  const old = sealRefreshToken("xoxb-old-test", "org:slack:team");
  row = { id: "existing-connection", org_id: "org", provider: "slack", external_account_id: "team",
    state: "active", last_error: null, token_sealed: old.tokenSealed, dek_sealed: old.dekSealed };
  vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 8).toString("base64"));
  upsert.mockImplementation(async (value) => { row = { ...row, ...value }; return { error: null }; });
  const query = {
    select: () => query, eq: () => query, in: () => query, upsert,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [row], error: null }).then(resolve),
  };
  from.mockReturnValue(query);
  vi.mocked(getServiceClient).mockReturnValue({ from } as never);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true,
    access_token: "xoxb-fresh-test", token_type: "bot", team: { id: "team", name: "QA workspace" },
    scope: "channels:read,channels:history",
  }), { status: 200 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("existing Slack OAuth reconnect flow", () => {
  it("stores fresh credentials under current KEK, clears errors, preserves connection identity and mappings", async () => {
    expect((await connectionHealth("org"))["existing-connection"]).toBe("needs_reconnect");
    const response = await GET(new Request("https://qa.conductflow.test/auth/slack/connect/callback?state=test-nonce&code=test-code"));
    expect(response.headers.get("location")).toBe("https://qa.conductflow.test/settings");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ state: "active", last_error: null }),
      { onConflict: "org_id,provider,external_account_id" });
    expect(row.id).toBe("existing-connection");
    expect(openRefreshToken({ tokenSealed: row.token_sealed as string, dekSealed: row.dek_sealed as string },
      "org:slack:team")).toBe("xoxb-fresh-test");
    expect((await connectionHealth("org"))["existing-connection"]).toBe("connected");
    expect(from.mock.calls.every(([table]) => table === "connected_data_source")).toBe(true);
  });

  it("does not write credentials when OAuth state is invalid", async () => {
    const response = await GET(new Request("https://qa.conductflow.test/auth/slack/connect/callback?state=wrong&code=test-code"));
    expect(response.headers.get("location")).toBe("https://qa.conductflow.test/settings?error=slack_connect_failed");
    expect(upsert).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
