import { describe, it, expect } from "vitest";
import { navItems } from "@/components/nav/AppNav";

describe("navItems", () => {
  it("offers the destinations in a fixed order", () => {
    expect(navItems("/queue").map((i) => i.href))
      .toEqual(["/queue", "/tasks", "/roi", "/settings",
        "/retainers", "/documents", "/scheduling", "/billing", "/risk", "/scope", "/reviews", "/leads", "/reports"]);
    expect(navItems("/queue").map((i) => i.label))
      .toEqual(["Queue", "Tasks", "ROI", "Settings",
        "Retainers", "Documents", "Scheduling", "Billing", "Payment Risk", "Scope of work", "Reviews & referrals", "Leads", "Reports"]);
  });

  it("marks exactly one destination current", () => {
    for (const path of ["/queue", "/tasks", "/roi", "/settings",
      "/retainers", "/documents", "/scheduling", "/billing", "/risk", "/scope", "/reviews", "/leads", "/reports"]) {
      const current = navItems(path).filter((i) => i.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0].href).toBe(path);
    }
  });

  it("keeps the parent current on a nested route", () => {
    for (const path of ["/queue", "/retainers", "/documents", "/scheduling", "/billing", "/risk", "/scope", "/reviews", "/leads", "/reports"]) {
      const items = navItems(`${path}/00000000-0000-0000-0000-0000000000f1`);
      expect(items.find((i) => i.href === path)!.isCurrent).toBe(true);
      expect(items.filter((i) => i.isCurrent)).toHaveLength(1);
    }
  });

  it("marks nothing current on a route outside the nav", () => {
    // /ingest is an action, not a destination, so no tab lights up while adding one.
    expect(navItems("/ingest").some((i) => i.isCurrent)).toBe(false);
    expect(navItems("/onboarding").some((i) => i.isCurrent)).toBe(false);
  });

  it("does not treat a prefix collision as the same route", () => {
    // A future /settings-export must not light up Settings.
    expect(navItems("/settings-export").some((i) => i.isCurrent)).toBe(false);
  });

  it("marks nothing current for an empty pathname", () => {
    expect(navItems("").some((i) => i.isCurrent)).toBe(false);
  });
});
