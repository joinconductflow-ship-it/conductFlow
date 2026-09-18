import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "@/components/marketing/Landing";

// Test-process fixtures only. The landing page fetches nothing.
const html = (signedIn: boolean) => renderToStaticMarkup(createElement(Landing, { signedIn }));

describe("Landing", () => {
  it("offers sign-in to a visitor who has not signed in", () => {
    const markup = html(false);
    expect(markup).toContain(">Sign in<");
    expect(markup).toContain('href="/onboarding"');
  });

  /*
   * The point of the signed-in mode. This page renders inside the app layout, below the
   * real nav, for someone who is already authenticated: every "sign in" affordance on it
   * is at best dead weight and at worst a prompt to log in again.
   */
  it("offers no sign-in once you are signed in", () => {
    const markup = html(true);
    expect(markup).not.toContain(">Sign in<");
    expect(markup).not.toContain('href="/onboarding"');
  });

  it("points its calls to action into the app once you are signed in", () => {
    const markup = html(true);
    expect(markup).toContain('href="/queue"');
    expect(markup).toContain('href="/ingest"');
    expect(markup).toContain("Open your queue");
  });

  // The pitch itself is the same either way; only the affordances differ. If this breaks,
  // the two modes have started to fork and the shared component has stopped earning itself.
  it("says the same thing to both audiences", () => {
    for (const markup of [html(false), html(true)]) {
      expect(markup).toContain("AI orchestration");
      expect(markup).toContain("Download for macOS");
    }
  });
});
