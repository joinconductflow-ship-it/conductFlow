import { afterEach, expect, it, vi } from "vitest";
import { slackApi } from "@/lib/slack/client";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("waits Retry-After before retrying a short HTTP 429", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const result = slackApi("secret", "conversations.list");
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toMatchObject({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("returns a typed delay for long Retry-After values without retrying early", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "120" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(slackApi("secret", "conversations.history")).rejects.toMatchObject({ retryAfterSeconds: 120, reconnectRequired: false });
  expect(fetch).toHaveBeenCalledTimes(1);
});
