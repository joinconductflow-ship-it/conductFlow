import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { signInWithOtp: state.signIn } })),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@/lib/env", () => ({ requireEnv: vi.fn(() => "https://project.supabase.co") }));
vi.mock("@/lib/http/site-origin", () => ({ siteOrigin: vi.fn(async () => "https://app.example") }));

import { POST } from "@/app/auth/email/route";

describe("POST /auth/email consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.signIn.mockResolvedValue({ error: null });
  });

  function request(acceptance?: string) {
    const body = new URLSearchParams({ email: "new@example.test" });
    if (acceptance !== undefined) body.set("terms_accepted", acceptance);
    return new Request("https://app.example/auth/email", { method: "POST", body });
  }

  it.each([undefined, "false", "on"])("rejects acceptance %s before sending a link", async (acceptance) => {
    const response = await POST(request(acceptance));
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toBe("/onboarding");
    expect(target.searchParams.get("error"))
      .toBe("You must accept the Privacy Policy and Terms to continue.");
    expect(state.signIn).not.toHaveBeenCalled();
    expect(response.cookies.get("cf-terms-accepted")).toBeUndefined();
  });

  it("sends an accepted request and carries consent to the callback", async () => {
    const response = await POST(request("true"));
    expect(state.signIn).toHaveBeenCalledWith({ email: "new@example.test",
      options: { emailRedirectTo: "https://app.example/auth/callback" } });
    expect(response.status).toBe(303);
    expect(response.cookies.get("cf-terms-accepted"))
      .toMatchObject({ value: "true", httpOnly: true, sameSite: "lax", path: "/auth", maxAge: 3600 });
  });

  it("does not issue consent proof when sending the link fails", async () => {
    state.signIn.mockResolvedValue({ error: new Error("mail unavailable") });
    const response = await POST(request("true"));
    expect(response.cookies.get("cf-terms-accepted")).toBeUndefined();
    expect(new URL(response.headers.get("location")!).searchParams.get("error"))
      .toBe("magic_link_failed");
  });
});
