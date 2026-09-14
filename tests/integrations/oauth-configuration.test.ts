import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as connectSlack } from "@/app/auth/slack/connect/route";
import { GET as googleCallback } from "@/app/auth/google/connect/callback/route";
import { logFailure } from "@/lib/observability/log";

// Test-process fixtures only. No real OAuth credentials, requests, or database writes.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
  cookies: async () => ({ get: () => ({ value: "test-state:gmail_watch" }), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("@/lib/db/queries", () => ({ getCurrentOrgId: async () => "org", getCurrentUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/db/server", () => ({ getServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: "user", email: "qa@example.test" } } }),
} }) }));
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: () => ({ from }) }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SITE_ORIGIN", "http://localhost:3000");
  vi.stubEnv("SLACK_CLIENT_ID", "");
  vi.stubEnv("SLACK_CLIENT_SECRET", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-only-fixture");
  vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(6).toString("base64"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    refresh_token: "test-refresh", id_token: `header.${Buffer.from(JSON.stringify({ sub: "account", email: "qa@example.test" })).toString("base64url")}.signature`,
    scope: "openid email https://www.googleapis.com/auth/gmail.readonly", expires_in: 3600,
  }), { status: 200 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("local integration configuration and route behavior", () => {
  it("missing Slack client ID logs the cause and redirects with a safe error code", async () => {
    const response = await connectSlack();
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings?error=slack_connect_failed");
    expect(logFailure).toHaveBeenCalledWith("Slack connect start", expect.objectContaining({ message: "SLACK_CLIENT_ID is not set." }));
    expect(fetch).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:3000", "https://conductflow.tech"])("configured Slack start uses OAuth authorization and exact callback for %s", async (origin) => {
    vi.stubEnv("SITE_ORIGIN", origin);
    vi.stubEnv("SLACK_CLIENT_ID", "12345.67890");
    vi.stubEnv("SLACK_CLIENT_SECRET", "test-only-fixture");
    const response = await connectSlack();
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe(`${origin}/auth/slack/connect/callback`);
    expect(location.searchParams.get("client_id")).toBe("12345.67890");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain("slack_oauth_state=");
    expect(location.searchParams.has("client_secret")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Google exchange can succeed while malformed KEK prevents grant storage and returns google_connection_failed", async () => {
    const response = await googleCallback(new Request("http://localhost:3000/auth/google/connect/callback?code=test-code&state=test-state"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings?error=google_connection_failed");
    expect(logFailure).toHaveBeenCalledWith("Google capability grant save", expect.objectContaining({
      provider: "google", operation: "store_grant", error: expect.objectContaining({
        message: "DATA_SOURCE_KEK must decode to 32 bytes, got 6.",
      }),
    }));
    const body = vi.mocked(fetch).mock.calls[0][1]!.body as URLSearchParams;
    expect(body.get("redirect_uri")).toBe("http://localhost:3000/auth/google/connect/callback");
    expect(from).not.toHaveBeenCalled();
  });

  it("Google token-exchange failure uses the same safe code but a distinct logged stage", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    const response = await googleCallback(new Request("http://localhost:3000/auth/google/connect/callback?code=test-code&state=test-state"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings?error=google_connection_failed");
    expect(logFailure).toHaveBeenCalledWith("Google capability token exchange", expect.objectContaining({ status: 401 }));
    expect(from).not.toHaveBeenCalled();
  });
});
