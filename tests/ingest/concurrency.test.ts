import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/ingest/concurrency";

describe("mapWithConcurrency", () => {
  it("never runs more workers than the limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("settles every item in input order when one worker fails", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n * 10;
    });

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
    expect(results[3]).toEqual({ status: "fulfilled", value: 40 });
  });

  it("does not abandon later items after an early failure", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4], 1, async (n) => {
      seen.push(n);
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("rejects a non-positive concurrency limit", async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(/positive integer/i);
  });

  it("handles an empty batch", async () => {
    await expect(mapWithConcurrency([], 3, async (n) => n)).resolves.toEqual([]);
  });
});
