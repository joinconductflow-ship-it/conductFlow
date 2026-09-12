import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adapter: null as { setAll: (cookies: unknown[]) => void } | null,
  signIn: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: {
    cookies: { setAll: (cookies: unknown[]) => void };
  }) => {
    state.adapter = options.cookies;
    return { auth: { signInWithOAuth: state.signIn } };
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [] })),
}));
vi.mock("@/lib/env", () => ({ requireEnv: vi.fn(() => "https://project.supabase.co") }));
vi.mock("@/lib/http/site-origin", () => ({ siteOrigin: vi.fn(async () => "https://app.example") }));

import { GET } from "@/app/auth/signin/route";

describe("GET /auth/signin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.adapter = null;
    state.signIn.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" }, error: null,
    });
  });

  it("redirects to Google and preserves the PKCE verifier cookie", async () => {
    state.signIn.mockImplementation(async () => {
      state.adapter?.setAll([{
        name: "sb-project-auth-token-code-verifier", value: "pkce-value", options: { path: "/", sameSite: "lax" },
      }]);
      return { data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=test" }, error: null };
    });

    const response = await GET();
    expect(response.headers.get("location"))
      .toBe("https://accounts.google.com/o/oauth2/v2/auth?state=test");
    expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token-code-verifier=pkce-value");
    expect(state.signIn).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
      options: expect.objectContaining({ redirectTo: "https://app.example/auth/callback" }),
    }));
  });

  it("returns Supabase OAuth errors to onboarding", async () => {
    state.signIn.mockResolvedValue({ data: { url: null }, error: new Error("Google is disabled") });
    const response = await GET();
    expect(response.headers.get("location"))
      .toBe("https://app.example/onboarding?error=Google%20is%20disabled");
  });
});
