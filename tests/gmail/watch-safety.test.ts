import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanGmail } from "@/lib/gmail/watch";
import { createGmailClient } from "@/lib/gmail/client";
import { getAccessToken, DataSourceUnavailable } from "@/lib/google/tokens";
import { runIngest } from "@/lib/ingest/run";
import { scanDatabase } from "../integrations/scan-fixture";

vi.mock("@/lib/gmail/client", async (actual) => ({ ...await actual<typeof import("@/lib/gmail/client")>(), createGmailClient: vi.fn() }));
vi.mock("@/lib/google/tokens", async (actual) => ({ ...await actual<typeof import("@/lib/google/tokens")>(), getAccessToken: vi.fn() }));
vi.mock("@/lib/ingest/run", () => ({ runIngest: vi.fn() }));
vi.mock("@/lib/observability/log", () => ({ logFailure: vi.fn() }));
const now = new Date("2026-09-14T12:00:00Z"), last = new Date(now.getTime() - 86400000).toISOString();
function fixture(total = 25, sender = "client@example.com") {
  const f = scanDatabase({
    connected_data_source: [{ id: "c", org_id: "org", provider: "google", state: "active", gmail_last_scanned_at: last }],
    integration_scan_state: [{ connection_id: "c", gmail_until: null, gmail_cursor: null, gmail_listed: false }],
    client_contact: [{ id: "client", org_id: "org", name: "Client", email: "client@example.com" }],
  });
  const messages = Array.from({ length: total }, (_, i) => ({ id: String(i + 1), threadId: "t",
    internalDate: String(Date.parse(last) + (i + 1) * 1000), payload: {
      mimeType: "text/plain", headers: [{ name: "From", value: sender }, { name: "Subject", value: `Message ${i + 1}` }],
      body: { data: Buffer.from("I will send the report.").toString("base64url") },
    } }));
  const listMessagePage = vi.fn(async (_q: string, limit: number, cursor?: string) => {
    const offset = Number(cursor ?? 0), newest = [...messages].reverse();
    return { messages: newest.slice(offset, offset + limit).map((m) => ({ id: m.id })),
      nextPageToken: offset + limit < total ? String(offset + limit) : undefined };
  });
  const getMessage = vi.fn(async (id: string) => messages.find((m) => m.id === id) ?? null);
  vi.mocked(createGmailClient).mockReturnValue({ listMessagePage, getMessage } as unknown as ReturnType<typeof createGmailClient>);
  return { ...f, listMessagePage, getMessage };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getAccessToken).mockResolvedValue("private-token"); vi.mocked(runIngest).mockResolvedValue({} as never); });

describe("durable Gmail batches", () => {
  it("paginates all 25 messages, processes oldest first in capped batches, and advances only after completion", async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) await scanGmail(f.db, { orgId: "org", now });
    expect(f.listMessagePage.mock.calls.map((c) => c[2])).toEqual([undefined, "10", "20"]);
    expect(getAccessToken).toHaveBeenCalledWith(f.db, "org", expect.any(String), { connectionId: "c" });
    expect(f.tables.gmail_scan_pending).toHaveLength(25);
    expect(runIngest).not.toHaveBeenCalled();
    await scanGmail(f.db, { orgId: "org", now, maxMessagesPerOrg: 1000 });
    expect(runIngest).toHaveBeenCalledTimes(10);
    expect(f.tables.connected_data_source[0].gmail_last_scanned_at).toBe(last);
    await scanGmail(f.db, { orgId: "org", now });
    await scanGmail(f.db, { orgId: "org", now });
    expect(vi.mocked(runIngest).mock.calls.map((c) => c[1].title)).toEqual(Array.from({ length: 25 }, (_, i) => `Message ${i + 1}`));
    expect(f.tables.gmail_scan_pending).toHaveLength(0);
    expect(f.tables.connected_data_source[0].gmail_last_scanned_at).toBe(now.toISOString());
  });
  it("retains the failed message and every newer message, without reprocessing acknowledged predecessors", async () => {
    const f = fixture(4);
    await scanGmail(f.db, { orgId: "org", now });
    vi.mocked(runIngest).mockImplementation(async (_db, args) => { if (args.title === "Message 2") throw new Error("model failed"); return {} as never; });
    expect(await scanGmail(f.db, { orgId: "org", now })).toMatchObject({ ingested: 1, errors: 1 });
    expect(f.tables.gmail_scan_pending.map((m) => m.message_id)).toEqual(expect.arrayContaining(["2", "3", "4"]));
    expect(f.tables.gmail_scan_pending).toHaveLength(3);
    expect(f.tables.connected_data_source[0].gmail_last_scanned_at).toBe(last);
    vi.mocked(runIngest).mockResolvedValue({} as never);
    await scanGmail(f.db, { orgId: "org", now });
    expect(vi.mocked(runIngest).mock.calls.filter((c) => c[1].title === "Message 1")).toHaveLength(1);
  });
  it("does not acknowledge a listing page when a provider fetch fails", async () => {
    const f = fixture(3);
    f.getMessage.mockRejectedValueOnce(new Error("provider failed"));
    expect(await scanGmail(f.db, { orgId: "org", now })).toMatchObject({ errors: 1 });
    expect(f.tables.integration_scan_state[0].gmail_listed).toBe(false);
    expect(f.tables.connected_data_source[0].gmail_last_scanned_at).toBe(last);
  });
  it.each(["client_@example.com", "client%@example.com"])("treats %s literally, never as a wildcard", async (sender) => {
    const f = fixture(1, sender);
    await scanGmail(f.db, { orgId: "org", now });
    expect(await scanGmail(f.db, { orgId: "org", now })).toMatchObject({ ingested: 0, unmatchedSourcesRecorded: 1 });
    expect(runIngest).not.toHaveBeenCalled();
    expect(f.tables.integration_unmatched_source[0].source_key).toBe(sender);
  });
  it("uses an explicitly linked org-scoped alias on future scans", async () => {
    const f = fixture(1, " alias@Example.com ");
    f.tables.client_email_alias = [{ org_id: "other", email: "alias@example.com", client_contact_id: "foreign" },
      { org_id: "org", email: "alias@example.com", client_contact_id: "client" }];
    await scanGmail(f.db, { orgId: "org", now });
    expect(await scanGmail(f.db, { orgId: "org", now })).toMatchObject({ ingested: 1, unmatchedSourcesRecorded: 0 });
    expect(vi.mocked(runIngest).mock.calls[0][1].clientId).toBe("client");
  });
  it("does not invoke providers or ingestion while the shared lease is held", async () => {
    const f = fixture(1);
    f.tables.integration_scan_state[0].locked_until = new Date(Date.now() + 60_000).toISOString();
    expect(await scanGmail(f.db, { orgId: "org", now })).toMatchObject({ connectionsScanned: 0 });
    expect(getAccessToken).not.toHaveBeenCalled();
  });
  it("reports refused credentials as reconnect-required", async () => {
    const f = fixture(1);
    vi.mocked(getAccessToken).mockRejectedValue(new DataSourceUnavailable("refused", "refused"));
    expect(await scanGmail(f.db, { orgId: "org", now })).toMatchObject({ reconnectRequired: true, errors: 1 });
  });
});
