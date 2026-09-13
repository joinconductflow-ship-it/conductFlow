import { describe, expect, it } from "vitest";
import {
  copilotDateContext,
  resolveRelativeDate,
  validTimeZone,
} from "@/lib/copilot/date-context";

// 2026-09-12 is a Saturday; Codex reproduced the bug on exactly this date.
const SATURDAY = new Date("2026-09-12T12:00:00.000Z");
const ny = copilotDateContext(SATURDAY, "America/New_York");

describe("copilotDateContext", () => {
  it("computes the authoritative server date and weekday in the org timezone", () => {
    expect(ny.date).toBe("2026-09-12");
    expect(ny.weekday).toBe("Saturday");
    expect(ny.timeZone).toBe("America/New_York");
    expect(ny.nowIso).toBe(SATURDAY.toISOString());
  });

  it("uses the timezone, not UTC, when the instant falls on a different local day", () => {
    const justAfterMidnightUtc = new Date("2026-09-13T02:00:00.000Z");
    expect(copilotDateContext(justAfterMidnightUtc, "UTC").date).toBe("2026-09-13");
    expect(copilotDateContext(justAfterMidnightUtc, "America/Los_Angeles").date).toBe("2026-09-12");
  });

  it("falls back to UTC for an invalid or absent timezone", () => {
    expect(validTimeZone("Not/AZone")).toBe("UTC");
    expect(validTimeZone("")).toBe("UTC");
    expect(validTimeZone(undefined)).toBe("UTC");
    expect(validTimeZone("Europe/Paris")).toBe("Europe/Paris");
    expect(copilotDateContext(SATURDAY, "Not/AZone").timeZone).toBe("UTC");
  });
});

describe("resolveRelativeDate", () => {
  it("resolves the QA repro: next Tuesday from Saturday Sep 12 2026", () => {
    expect(resolveRelativeDate("next Tuesday", ny)).toBe("2026-09-15");
    expect(resolveRelativeDate("next tuesday at 4 PM", ny)).toBe("2026-09-15");
  });

  it("resolves today and tomorrow", () => {
    expect(resolveRelativeDate("today", ny)).toBe("2026-09-12");
    expect(resolveRelativeDate("tomorrow", ny)).toBe("2026-09-13");
  });

  it("resolves this Friday to the upcoming Friday", () => {
    expect(resolveRelativeDate("this Friday", ny)).toBe("2026-09-18");
  });

  it("resolves next week to the following week's Friday", () => {
    expect(resolveRelativeDate("next week", ny)).toBe("2026-09-25");
  });

  it("treats a bare weekday as strictly after today", () => {
    expect(resolveRelativeDate("Saturday", ny)).toBe("2026-09-19");
    expect(resolveRelativeDate("Monday", ny)).toBe("2026-09-14");
  });

  it("crosses a year boundary correctly", () => {
    const newYearsEve = copilotDateContext(new Date("2026-12-31T12:00:00.000Z"), "UTC");
    expect(newYearsEve.weekday).toBe("Thursday");
    expect(resolveRelativeDate("next Monday", newYearsEve)).toBe("2027-01-04");
    expect(resolveRelativeDate("next week", newYearsEve)).toBe("2027-01-08");
    expect(resolveRelativeDate("tomorrow", newYearsEve)).toBe("2027-01-01");
  });

  it("does not hardcode 2026 — a different server year resolves in that year", () => {
    const future = copilotDateContext(new Date("2031-03-01T12:00:00.000Z"), "UTC");
    expect(resolveRelativeDate("tomorrow", future)).toMatch(/^2031-03-/);
    expect(resolveRelativeDate("next Tuesday", future)).toMatch(/^2031-03-/);
  });

  it("passes an explicit ISO date through", () => {
    expect(resolveRelativeDate("2027-05-04", ny)).toBe("2027-05-04");
  });

  it("returns undefined for phrases it cannot resolve rather than guessing", () => {
    expect(resolveRelativeDate("sometime soon", ny)).toBeUndefined();
    expect(resolveRelativeDate("", ny)).toBeUndefined();
  });
});
