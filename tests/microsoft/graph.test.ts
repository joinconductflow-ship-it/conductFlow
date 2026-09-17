import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraphClient, GraphError, GraphUnauthorizedError, GraphForbiddenError, GraphRateLimitError,
  GraphServerError, listMyTeams, splitChannelId } from "@/lib/microsoft/graph";

afterEach(() => vi.unstubAllGlobals());

describe("Microsoft Graph API", () => {
  it("maps authentication, permission, server, and other errors", async () => {
    for (const [status, errorType, retryable, reconnectRequired] of [
      [401, GraphUnauthorizedError, false, true], [403, GraphForbiddenError, false, true],
      [503, GraphServerError, true, false], [400, GraphError, false, false],
    ] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(Response.json({ error: { message: "Provider detail" } }, { status }));
      const request = createGraphClient("private-token", { fetchImpl, maxRetries: 0 }).listMyTeams();
      await expect(request).rejects.toBeInstanceOf(errorType);
      await expect(request).rejects.toMatchObject({ status, retryable, reconnectRequired });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("preserves the provider's permission error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "Missing permission" } }, { status: 403 })));
    await expect(listMyTeams("private-token")).rejects.toThrow("Missing permission");
  });

  it("returns a typed delay for long Retry-After without retrying early", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    const wait = vi.fn();
    const request = createGraphClient("token", { fetchImpl, wait, maxRetryWaitMs: 5000 }).listMyTeams();
    await expect(request).rejects.toBeInstanceOf(GraphRateLimitError);
    await expect(request).rejects.toMatchObject({ retryAfterSeconds: 120, reconnectRequired: false, retryable: true });
    expect(wait).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors short Retry-After delays", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(Response.json({ value: [] }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(createGraphClient("token", { fetchImpl, wait }).listMyTeams()).resolves.toEqual([]);
    expect(wait).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries server errors with bounded exponential backoff", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("", { status: 503 }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(createGraphClient("token", { fetchImpl, wait }).listMyTeams()).rejects.toBeInstanceOf(GraphServerError);
    expect(wait.mock.calls).toEqual([[500], [1000]]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns null only for a missing message, never a failed listing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const client = createGraphClient("token", { fetchImpl });
    await expect(client.getInboxMessage("missing")).resolves.toBeNull();
    await expect(client.listInboxMessagePage("since", "until", 10)).rejects.toMatchObject({ status: 404 });
  });

  it("uses the full nextLink unchanged and does not sweep subsequent mail pages", async () => {
    const next = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=opaque%2Bcursor";
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ value: [{ id: "m" }], "@odata.nextLink": next }));
    const client = createGraphClient("token", { fetchImpl });
    expect(await client.listInboxMessagePage("since", "until", 10, next)).toEqual({ messages: [{ id: "m" }], nextLink: next });
    expect(fetchImpl.mock.calls[0][0]).toBe(next);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin pagination before forwarding a token", async () => {
    const fetchImpl = vi.fn();
    await expect(createGraphClient("secret", { fetchImpl }).listInboxMessagePage("since", "until", 10,
      "https://example.com/messages")).rejects.toThrow("Invalid Graph pagination URL");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("splits a compound channel id without splitting Teams' own colon", () => {
    expect(splitChannelId("team:19:channel@thread.tacv2")).toEqual({ teamId: "team", channelId: "19:channel@thread.tacv2" });
  });
});
