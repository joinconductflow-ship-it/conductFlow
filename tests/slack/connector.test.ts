import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableChannels, channelHistory, senderLookup, slackApi, slackToken, SlackRateLimitError } from "@/lib/slack/client";
import { scanSlack } from "@/lib/slack/watch";
import { runIngest } from "@/lib/ingest/run";
import { scanDatabase } from "../integrations/scan-fixture";
import { sealRefreshToken } from "@/lib/google/vault";
import { DataSourceUnavailable } from "@/lib/google/tokens";

vi.mock("@/lib/ingest/run", () => ({ runIngest: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));
const fetchMock = vi.fn();
const now = new Date("2026-09-12T12:00:00.000Z");
const messageTime = String(now.getTime() / 1000 - 60);
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 7).toString("base64"));
  fetchMock.mockReset();
  vi.mocked(runIngest).mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Slack API", () => {
  it("rejects HTTP 200 API failures", async () => {
    fetchMock.mockResolvedValue(json({ ok: false, error: "missing_scope" }));
    await expect(slackApi("token", "conversations.list")).rejects.toThrow("missing_scope");
  });

  it("paginates channels and orders them by name", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, channels: [{ id: "C2", name: "zeta" }], response_metadata: { next_cursor: "next" } }))
      .mockResolvedValueOnce(json({ ok: true, channels: [{ id: "C1", name: "alpha" }] }));
    expect((await availableChannels("token")).map((channel) => channel.id)).toEqual(["C1", "C2"]);
    expect(fetchMock.mock.calls[1][1].body.get("cursor")).toBe("next");
  });

  it("paginates history, deduplicates timestamps, and preserves chronology", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, messages: [{ ts: "3", text: "third" }], has_more: true, response_metadata: { next_cursor: "next" } }))
      .mockResolvedValueOnce(json({ ok: true, messages: [{ ts: "3", text: "third" }, { ts: "2", text: "second" }] }));
    expect((await channelHistory("token", "C1", "1", "4")).map((message) => message.ts)).toEqual(["2", "3"]);
  });

  it("includes the upper checkpoint boundary without replaying the lower boundary", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, messages: [{ ts: "1" }, { ts: "4" }] }));
    expect((await channelHistory("token", "C1", "1", "4")).map((message) => message.ts)).toEqual(["4"]);
  });

  it("fails closed on incomplete history and rate limits", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, messages: [], has_more: true }));
    await expect(channelHistory("token", "C1", "1", "4")).rejects.toThrow("incomplete history");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "60" } }));
    await expect(slackApi("token", "users.info")).rejects.toMatchObject({ retryAfterSeconds: 60 } satisfies Partial<SlackRateLimitError>);
  });

  it("caches sender names within a scan", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, user: { profile: { display_name: "Priya" } } }));
    const lookup = senderLookup("token");
    expect(await lookup("U1")).toBe("Priya");
    expect(await lookup("U1")).toBe("Priya");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

type Row = Record<string, unknown>;
function fixture() {
  const sealed = sealRefreshToken("xoxb-test", "org:slack:team");
  const mapping: Row = { id: "mapping", org_id: "org", connected_data_source_id: "connection",
    channel_id: "C1", channel_name: "client-work", client_contact_id: "client", last_scanned_at: null, scan_listed: false };
  const tables: Record<string, Row[]> = {
    connected_data_source: [{ id: "connection", org_id: "org", provider: "slack", state: "active",
      external_account_id: "team", token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed },
      { id: "foreign", org_id: "other", provider: "slack", state: "active" }],
    slack_channel_mapping: [mapping], client_contact: [{ id: "client", org_id: "org", name: "Acme" }],
  };
  tables.integration_scan_state = [{ connection_id: "connection", slack_cursor: "" }];
  const { db } = scanDatabase(tables);
  fetchMock.mockImplementation(async (url: string) => url.endsWith("conversations.list") ? json({ ok: true, channels: [] }) : url.endsWith("users.info")
    ? json({ ok: true, user: { profile: { display_name: "Priya" } } })
    : json({ ok: true, messages: [{ ts: messageTime, user: "U1", text: "I will deliver the report tomorrow." }] }));
  return { db, mapping, tables };
}

describe("Slack credential state", () => {
  it("marks a key-mismatched credential as reconnect-required", async () => {
    const { db, tables } = fixture();
    vi.stubEnv("DATA_SOURCE_KEK", Buffer.alloc(32, 8).toString("base64"));

    await expect(slackToken(db, "org", "connection")).rejects.toMatchObject({
      reason: "reconnect",
    } satisfies Partial<DataSourceUnavailable>);
    expect(tables.connected_data_source[0].state).toBe("error");
    expect(tables.connected_data_source[0].last_error).toBe("credential_decryption_failed");
  });
});

describe("Slack scan", () => {
  it("ingests directly for the mapped client and checkpoints successful scans", async () => {
    const { db, mapping } = fixture();
    await scanSlack(db, { orgId: "org", now });
    const result = await scanSlack(db, { orgId: "org", now });
    expect(result).toMatchObject({ connectionsScanned: 1, channelsScanned: 1, ingested: 1, errors: 0 });
    expect(runIngest).toHaveBeenCalledWith(db, expect.objectContaining({ orgId: "org", clientId: "client",
      clientName: "Acme", transcript: expect.stringContaining("Priya: I will deliver") }), undefined);
    expect(mapping.last_scanned_at).toBe(now.toISOString());
    expect(fetchMock.mock.calls.find((c) => String(c[0]).endsWith("conversations.history"))?.[1].body.get("oldest")).toBe(((now.getTime() - 86400000) / 1000).toFixed(3));
  });

  it("retains the checkpoint when ingestion fails", async () => {
    const { db, mapping } = fixture();
    await scanSlack(db, { orgId: "org", now });
    const checkpoint = mapping.last_scanned_at;
    vi.mocked(runIngest).mockRejectedValue(new Error("model unavailable"));
    expect(await scanSlack(db, { orgId: "org", now })).toMatchObject({ ingested: 0, channelsScanned: 0, errors: 1 });
    expect(mapping.last_scanned_at).toBe(checkpoint);
  });

  it("advances empty scans without calling ingestion", async () => {
    const { db, mapping } = fixture();
    fetchMock.mockImplementation(async () => json({ ok: true, channels: [], messages: [] }));
    await scanSlack(db, { orgId: "org", now });
    expect(await scanSlack(db, { orgId: "org", now })).toMatchObject({ channelsScanned: 1, ingested: 0, errors: 0 });
    expect(runIngest).not.toHaveBeenCalled();
    expect(mapping.last_scanned_at).toBe(now.toISOString());
  });
});
