import { describe, it, expect } from "vitest";
import { navGroups, navItems } from "@/components/nav/AppNav";

const ALL = ["/queue", "/tasks", "/scheduling", "/leads", "/retainers", "/scope", "/reviews",
  "/billing", "/risk", "/documents", "/reports", "/roi", "/settings"];

describe("navGroups", () => {
  it("offers seven tabs", () => {
    expect(navGroups("/queue").map((g) => g.label))
      .toEqual(["Queue", "Tasks", "Clients", "Billing", "Documents", "Reports", "Settings"]);
  });

  /*
   * The point of the grouping. Seven tabs replaced five tabs plus a "More" menu, and the
   * one thing that must not happen is a destination falling out of the nav in the process:
   * with no overflow menu left, anything missing here is unreachable except by typing the
   * URL. This asserts the set, not the order, so regrouping stays cheap.
   */
  it("still reaches every destination", () => {
    const hrefs = navItems("/queue").map((i) => i.href);
    expect([...hrefs].sort()).toEqual([...ALL].sort());
    expect(new Set(hrefs).size).toBe(ALL.length);
  });

  it("lights the group that owns the current destination", () => {
    const groups = navGroups("/risk");
    const current = groups.filter((g) => g.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].label).toBe("Billing");
    expect(current[0].items.find((i) => i.href === "/risk")!.isCurrent).toBe(true);
  });

  it("marks exactly one destination current, from any destination", () => {
    for (const path of ALL) {
      const current = navItems(path).filter((i) => i.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0].href).toBe(path);
    }
  });

  it("keeps the parent current on a nested route", () => {
    for (const path of ["/queue", "/retainers", "/documents", "/scheduling", "/billing",
      "/risk", "/scope", "/reviews", "/leads", "/reports"]) {
      const items = navItems(`${path}/00000000-0000-0000-0000-0000000000f1`);
      expect(items.find((i) => i.href === path)!.isCurrent).toBe(true);
      expect(items.filter((i) => i.isCurrent)).toHaveLength(1);
    }
  });

  // The second row renders for a current group with more than one destination. A group of
  // one would render a sub-nav whose only entry repeats the tab above it.
  it("has a second row only where there is somewhere else to go", () => {
    const sizes = Object.fromEntries(navGroups("/queue").map((g) => [g.label, g.items.length]));
    expect(sizes).toEqual({
      Queue: 1, Tasks: 2, Clients: 4, Billing: 2, Documents: 1, Reports: 2, Settings: 1,
    });
  });

  it("marks nothing current on a route outside the nav", () => {
    // /ingest is an action, not a destination, so no tab lights up while adding one.
    for (const path of ["/ingest", "/onboarding", "/", ""]) {
      expect(navGroups(path).some((g) => g.isCurrent)).toBe(false);
    }
  });

  it("does not treat a prefix collision as the same route", () => {
    // A future /settings-export must not light up Settings.
    expect(navGroups("/settings-export").some((g) => g.isCurrent)).toBe(false);
  });
});
