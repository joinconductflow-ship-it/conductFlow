import { afterEach, describe, expect, it, vi } from "vitest";
import { channelHistory, senderLookup, slackApi } from "@/lib/slack/client";

afterEach(() => vi.unstubAllGlobals());

describe("Slack API", () => {
  it("rejects Slack errors even with HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, error: "invalid_auth" })));
    await expect(slackApi("token", "conversations.list")).rejects.toThrow("invalid_auth");
  });

  it("collects every history page in chronological order", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, messages: [{ ts: "2.000001", text: "second" }], has_more: true, response_metadata: { next_cursor: "next" } }))
      .mockResolvedValueOnce(Response.json({ ok: true, messages: [{ ts: "1.000001", text: "first" }], has_more: false }));
    vi.stubGlobal("fetch", fetchMock);
    const messages = await channelHistory("token", "channel", "0", "3");
    expect(messages.map((m) => m.text)).toEqual(["first", "second"]);
    expect(fetchMock.mock.calls[1][1].body.get("cursor")).toBe("next");
    expect(fetchMock.mock.calls[1][1].body.get("latest")).toBe("3");
  });

  it("does not accept incomplete history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, messages: [], has_more: true })));
    await expect(channelHistory("token", "channel", "0", "3")).rejects.toThrow("incomplete history");
  });

  it("caches resolved display names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, user: { profile: { display_name: "Alex" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const name = senderLookup("token");
    expect(await name("U123")).toBe("Alex");
    expect(await name("U123")).toBe("Alex");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
