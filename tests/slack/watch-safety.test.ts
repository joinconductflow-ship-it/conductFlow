import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanSlack } from "@/lib/slack/watch";
import { availableChannelPage, historyPage, slackToken, SlackApiError, SlackRateLimitError } from "@/lib/slack/client";
import { runIngest } from "@/lib/ingest/run";
import { scanDatabase } from "../integrations/scan-fixture";

vi.mock("@/lib/slack/client", async (actual) => ({ ...await actual<typeof import("@/lib/slack/client")>(),
  availableChannelPage: vi.fn(), historyPage: vi.fn(), slackToken: vi.fn(), senderLookup: () => async (id: string) => id }));
vi.mock("@/lib/ingest/run", () => ({ runIngest: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));
const now = new Date("2026-09-14T12:00:00Z"), last = new Date(now.getTime() - 86400000).toISOString();
function fixture(mapped = true) {
  return scanDatabase({
    connected_data_source: [{ id: "c", org_id: "org", provider: "slack", state: "active" }],
    integration_scan_state: [{ connection_id: "c", slack_cursor: "" }],
    slack_channel_mapping: mapped ? [{ id: "m", org_id: "org", connected_data_source_id: "c", channel_id: "C1",
      channel_name: "client", client_contact_id: "client", last_scanned_at: last, scan_listed: false }] : [],
    client_contact: [{ id: "client", org_id: "org", name: "Client" }],
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(slackToken).mockResolvedValue("token");
  vi.mocked(availableChannelPage).mockResolvedValue({ channels: [], cursor: "" });
  vi.mocked(historyPage).mockResolvedValue({ messages: [{ ts: String(now.getTime() / 1000 - 1), text: "I will deliver", user: "U1" }], cursor: "" });
  vi.mocked(runIngest).mockResolvedValue({} as never);
});
describe("bounded Slack scan", () => {
  it("never reads unknown channel history or calls the model, and counts only newly opened sources", async () => {
    const f = fixture(false);
    vi.mocked(availableChannelPage).mockResolvedValue({ channels: [{ id: "C2", name: "unknown", is_member: true }], cursor: "next" });
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ unmatchedSourcesRecorded: 1, ingested: 0 });
    expect(f.tables.integration_scan_state[0].slack_cursor).toBe("next");
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ unmatchedSourcesRecorded: 0 });
    expect(availableChannelPage).toHaveBeenLastCalledWith("token", "next");
    expect(historyPage).not.toHaveBeenCalled();
    expect(runIngest).not.toHaveBeenCalled();
  });
  it("retains failed mapped messages and checkpoints until the next successful batch", async () => {
    const f = fixture();
    await scanSlack(f.db, { orgId: "org", now });
    expect(runIngest).not.toHaveBeenCalled();
    vi.mocked(runIngest).mockRejectedValueOnce(new Error("model failed"));
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ errors: 1, ingested: 0 });
    expect(f.tables.slack_scan_pending).toHaveLength(1);
    expect(f.tables.slack_channel_mapping[0].last_scanned_at).toBe(last);
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ ingested: 1 });
    expect(f.tables.slack_channel_mapping[0].last_scanned_at).toBe(now.toISOString());
    expect(f.tables.slack_scan_pending).toHaveLength(0);
  });
  it("reads one page at a time and processes at most 20 messages oldest first", async () => {
    const f = fixture();
    const messages = Array.from({ length: 25 }, (_, i) => ({ ts: String(now.getTime() / 1000 - 25 + i), text: `Message ${i}` }));
    vi.mocked(historyPage).mockResolvedValueOnce({ messages: messages.slice(10).reverse(), cursor: "older" })
      .mockResolvedValueOnce({ messages: messages.slice(0, 10).reverse(), cursor: "" });
    await scanSlack(f.db, { orgId: "org", now });
    expect(historyPage).toHaveBeenCalledTimes(1);
    await scanSlack(f.db, { orgId: "org", now });
    expect(vi.mocked(historyPage).mock.calls[1][4]).toBe("older");
    expect(runIngest).not.toHaveBeenCalled();
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ messagesConsidered: 20 });
    expect(f.tables.slack_scan_pending).toHaveLength(5);
    expect(f.tables.slack_channel_mapping[0].last_scanned_at).toBe(last);
    expect(vi.mocked(runIngest).mock.calls[0][1].transcript.indexOf("Message 0")).toBeLessThan(vi.mocked(runIngest).mock.calls[0][1].transcript.indexOf("Message 19"));
    await scanSlack(f.db, { orgId: "org", now });
    expect(f.tables.slack_scan_pending).toHaveLength(0);
  });
  it.each(["token_revoked", "missing_scope"])("classifies %s as reconnect-required", async (code) => {
    const f = fixture();
    vi.mocked(availableChannelPage).mockRejectedValue(new SlackApiError(code, 200));
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ reconnectRequired: true, errors: 1 });
  });
  it("durably honors a long Retry-After and prevents overlapping retries", async () => {
    const f = fixture();
    vi.mocked(availableChannelPage).mockRejectedValue(new SlackRateLimitError(120));
    await scanSlack(f.db, { orgId: "org", now });
    expect(Date.parse(String(f.tables.integration_scan_state[0].locked_until))).toBeGreaterThan(Date.now() + 119_000);
    expect(await scanSlack(f.db, { orgId: "org", now })).toMatchObject({ connectionsScanned: 0 });
    expect(availableChannelPage).toHaveBeenCalledTimes(1);
  });
});
