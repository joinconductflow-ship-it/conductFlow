import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Test-process fixtures only. No real session, request, or database.
const redirect = vi.hoisted(() => vi.fn((path: string) => {
  // Next's real redirect throws to unwind the render; mirroring that keeps the layout's
  // control flow honest, since code after the call must not run.
  throw Object.assign(new Error(`NEXT_REDIRECT:${path}`), { digest: `NEXT_REDIRECT;${path}` });
}));
// AppNav marks the current destination, so the nav needs a pathname to render.
vi.mock("next/navigation", () => ({ redirect, usePathname: () => "/queue" }));

const getCurrentUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/queries", () => ({ getCurrentUser }));

// readPageData wraps a lookup and reports whether it failed rather than throwing.
vi.mock("@/lib/db/page-read", () => ({
  readPageData: async (_label: string, read: () => Promise<unknown>) => {
    try {
      return { data: await read(), unavailable: false };
    } catch {
      return { data: null, unavailable: true };
    }
  },
}));

import AppLayout from "@/app/(app)/layout";
import HomePage from "@/app/(app)/page";

const child = createElement("main", null, "Protected content");

beforeEach(() => { redirect.mockClear(); getCurrentUser.mockReset(); });

describe("(app) layout auth gate", () => {
  it("sends a signed-out visitor to the login instead of rendering the page", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(AppLayout({ children: child })).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(redirect).toHaveBeenCalledWith("/onboarding");
  });

  it("renders the page and the nav for a signed-in user", async () => {
    getCurrentUser.mockResolvedValue({ email: "owner@example.test" });
    const html = renderToStaticMarkup(await AppLayout({ children: child }));
    expect(html).toContain("Protected content");
    expect(html).toContain("owner@example.test");
    expect(redirect).not.toHaveBeenCalled();
  });

  /*
   * The distinction the gate turns on. "No session" and "could not read the session" look
   * identical at the call site and mean opposite things: one is an anonymous visitor, the
   * other is a database blip in front of someone who is signed in. Redirecting on the
   * second would log out every valid session for as long as the outage lasted.
   */
  it("does not redirect when the session lookup itself fails", async () => {
    getCurrentUser.mockRejectedValue(new Error("auth offline"));
    const html = renderToStaticMarkup(await AppLayout({ children: child }));
    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain("Protected content");
    expect(html).toContain("temporarily unavailable");
  });

  /*
   * The composition, which neither the layout test nor the Landing test covers on its own:
   * the signed-in home is the landing content rendered *inside* the app shell. This is the
   * thing a browser would show and that no local sign-in is available to check, so it is
   * pinned here instead.
   */
  it("renders the landing content under the app nav at /", async () => {
    getCurrentUser.mockResolvedValue({ email: "owner@example.test" });
    const html = renderToStaticMarkup(await AppLayout({ children: HomePage() }));

    expect(html).toContain("owner@example.test");
    expect(html).toContain("AI orchestration");
    expect(html).toContain('href="/queue"');

    // The whole point of the signed-in mode: no sign-in affordance survives.
    expect(html).not.toContain('href="/onboarding"');
    expect(html).not.toContain(">Sign in<");
  });

  /*
   * The landing content carries its own <header> with the brand, the section anchors and
   * an account link, written for a page with nothing above it. Signed in, the app nav is
   * above it and carries all three, so rendering both printed "ConductFlow" twice within
   * 30px and gave the page two rows of chrome before any content. Only one survives.
   */
  it("shows one set of chrome, not the landing header stacked under the app nav", async () => {
    getCurrentUser.mockResolvedValue({ email: "owner@example.test" });
    const html = renderToStaticMarkup(await AppLayout({ children: HomePage() }));
    expect(html).not.toContain("<header");
    expect((html.match(/<nav/g) ?? []).length).toBe(1);
  });
});
