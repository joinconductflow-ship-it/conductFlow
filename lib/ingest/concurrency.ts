/**
 * Runs `worker` over `items` with at most `limit` in flight at once, returning one
 * `PromiseSettledResult` per item in input order.
 *
 * `Promise.allSettled(items.map(worker))` starts every worker immediately: a transcript
 * that yielded fifty commitments launched fifty simultaneous model calls, which tripped
 * the provider's rate limit and produced a burst of 429s. This keeps the same per-item
 * contract — one rejected worker is captured, not allowed to abort the batch — while
 * capping how many can be in flight together. The worker's rejection reason is passed
 * through unchanged, so callers can keep logging it with `logFailure`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Concurrency limit must be a positive integer.");
  }

  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}
