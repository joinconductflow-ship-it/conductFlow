import { expect, it, vi } from "vitest";
import { createGmailClient } from "@/lib/gmail/client";
it("passes Gmail page tokens and returns the next cursor without sweeping more pages", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "m" }], nextPageToken: "next" }));
  const client = createGmailClient("private-token", { fetchImpl });
  expect(await client.listMessagePage("after:100 before:200", 10, "previous")).toEqual({ messages: [{ id: "m" }], nextPageToken: "next" });
  const url = new URL(fetchImpl.mock.calls[0][0]);
  expect(url.searchParams.get("pageToken")).toBe("previous");
  expect(url.searchParams.get("maxResults")).toBe("10");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("never treats a failed listing as an empty successful window", async () => {
  const client = createGmailClient("token", { fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 404 })) });
  await expect(client.listMessagePage("after:100", 10)).rejects.toMatchObject({ status: 404 });
});
it("defers long watcher Retry-After waits without changing draft retry defaults", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "60" } }));
  const wait = vi.fn();
  const watcher = createGmailClient("token", { fetchImpl, wait, maxRetryWaitMs: 5000 });
  await expect(watcher.listMessagePage("after:100", 10)).rejects.toMatchObject({ status: 429 });
  expect(wait).not.toHaveBeenCalled();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
