import { afterEach, describe, expect, it, vi } from "vitest";
import { redirect, notFound } from "next/navigation";
import { readPageData, readPageQuery } from "@/lib/db/page-read";

afterEach(() => vi.restoreAllMocks());

describe("render-only read boundary", () => {
  it("distinguishes successful empty results from unavailable reads", async () => {
    await expect(readPageQuery("/reviews: received_review", async () => ({ data: [], error: null })))
      .resolves.toEqual({ data: [], unavailable: false });
    await expect(readPageData("/reviews: optional", async () => null))
      .resolves.toEqual({ data: null, unavailable: false });
  });

  it("logs all database error fields and discards partial data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = { code: "42501", message: "permission denied", details: "table received_review", hint: "check grants" };
    await expect(readPageQuery("/reviews: received_review", async () => ({ data: ["partial"], error })))
      .resolves.toEqual({ data: null, unavailable: true });
    const output = log.mock.calls.flat().join(" ");
    for (const value of ["/reviews", ...Object.values(error)]) expect(output).toContain(value);
  });

  it("isolates thrown and rejected reads while keeping a sibling result", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("fetch failed", { cause: new Error("ECONNRESET") });
    const results = await Promise.all([
      readPageQuery("/reviews: drafts", () => { throw error; }),
      readPageQuery("/reviews: reviews", () => Promise.reject(error)),
      readPageData("/reviews: healthy", async () => ["healthy"]),
    ]);
    expect(results.map((result) => result.unavailable)).toEqual([true, true, false]);
    expect(results[2].data).toEqual(["healthy"]);
    expect(log.mock.calls.flat().join(" ")).toContain("ECONNRESET");
    expect(log.mock.calls.flat().join(" ")).toContain("stack");
  });

  it.each([redirect, () => notFound()])("preserves Next.js control flow", async (controlFlow) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readPageData("control flow", async () => controlFlow("/onboarding"))).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});
