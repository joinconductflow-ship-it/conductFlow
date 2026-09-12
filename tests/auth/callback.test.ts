import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adapter: null as { setAll: (cookies: unknown[]) => void } | null,
  exchange: vi.fn(),
  getUser: vi.fn(),
  bootstrap: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: {
    cookies: { setAll: (cookies: unknown[]) => void };
  }) => {
    state.adapter = options.cookies;
    return { auth: { exchangeCodeForSession: state.exchange, getUser: state.getUser } };
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [] })),
}));
vi.mock("@/lib/env", () => ({ requireEnv: vi.fn(() => "https://project.supabase.co") }));
vi.mock("@/lib/db/service", () => ({ getServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/bootstrap", () => ({ bootstrapUser: state.bootstrap }));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.adapter = null;
    state.exchange.mockResolvedValue({ error: null });
    state.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "owner@example.test", user_metadata: {} } },
      error: null,
    });
    state.bootstrap.mockResolvedValue({ orgId: "org-1", created: true });
  });

  it("persists the exchanged session before redirecting a successful login to /queue", async () => {
    state.exchange.mockImplementation(async () => {
      state.adapter?.setAll([{
        name: "sb-project-auth-token", value: "session-value", options: { path: "/", sameSite: "lax" },
      }]);
      return { error: null };
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=abc"));
    expect(response.headers.get("location")).toBe("https://app.example/queue");
    expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token=session-value");
    expect(state.bootstrap).toHaveBeenCalledWith({}, expect.objectContaining({ id: "user-1" }));
  });

  it("returns provider errors to onboarding", async () => {
    const response = await GET(new Request("https://app.example/auth/callback?error=access_denied"));
    expect(response.headers.get("location"))
      .toBe("https://app.example/onboarding?error=access_denied");
  });

  it("returns exchange failures to onboarding", async () => {
    state.exchange.mockResolvedValue({ error: new Error("invalid flow state") });
    const response = await GET(new Request("https://app.example/auth/callback?code=abc"));
    expect(response.headers.get("location"))
      .toBe("https://app.example/onboarding?error=invalid%20flow%20state");
  });
});
