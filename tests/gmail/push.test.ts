import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createGmailClient, GMAIL_ENDPOINTS, GmailForbiddenError, GmailInvalidGrantError,
  GmailRateLimitError, GmailServerError, GmailUnauthorizedError, type GmailClient,
} from "@/lib/gmail/client";
import { hashRawMessage } from "@/lib/gmail/mime";
import { pushDraftToGmail } from "@/lib/gmail/push";
import { logAudit } from "@/lib/audit/log";

vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

const ORG = "00000000-0000-0000-0000-00000000000a";
const DRAFT = "d0000000-0000-0000-0000-000000000001";
const COMMITMENT = "c0000000-0000-0000-0000-000000000001";
const CLIENT = "00000000-0000-0000-0000-0000000000c1";
const USER = "00000000-0000-0000-0000-0000000000a1";
const TOKEN = "ya29.super-secret-access-token";

// ---------------------------------------------------------------------------
// Fakes. Migration 0006 is authored but not applied, so the provider columns do not
// exist in the local database yet — these tests stay hermetic instead.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = () => tables[table] ?? [];
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              return {
                async maybeSingle() {
                  return { data: rows().find((r) => r[column] === value) ?? null, error: null };
                },
              };
            },
          };
        },
        update(patch: Row) {
          return {
            eq(column: string, value: unknown) {
              const matching = (extra?: (r: Row) => boolean) =>
                rows().filter((r) => r[column] === value && (!extra || extra(r)));
              const apply = (extra?: (r: Row) => boolean) => {
                const matched = matching(extra);
                matched.forEach((r) => Object.assign(r, patch));
                return matched;
              };
              return {
                is(column2: string, value2: unknown) {
                  return {
                    select() {
                      const matched = apply((r) => (r[column2] ?? null) === value2);
                      return Promise.resolve({
                        data: matched.map((r) => ({ id: r.id })), error: null,
                      });
                    },
                  };
                },
                then(onFulfilled: (v: { error: null }) => unknown, onRejected?: (e: unknown) => unknown) {
                  apply();
                  return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

class FakeGmailClient implements GmailClient {
  readonly created: string[] = [];
  readonly fetched: string[] = [];
  constructor(
    private readonly options: {
      exists?: boolean;
      failWith?: Error;
      draftId?: string;
      messageId?: string;
    } = {},
  ) {}

  async createDraft(raw: string) {
    if (this.options.failWith) throw this.options.failWith;
    this.created.push(raw);
    return {
      draftId: this.options.draftId ?? "gmail-draft-1",
      messageId: this.options.messageId ?? "gmail-message-1",
    };
  }

  async getDraft(draftId: string) {
    this.fetched.push(draftId);
    return { exists: this.options.exists ?? true };
  }
}

function seed(overrides: { draft?: Row; client?: Row } = {}) {
  return {
    deliverable_draft: [{
      id: DRAFT, org_id: ORG, commitment_id: COMMITMENT,
      kind: "email", subject: "Mia's practice set",
      body: "Confirming the revised set lands Friday.",
      provider: null, provider_draft_id: null, provider_message_id: null,
      pushed_at: null, pushed_by: null,
      ...overrides.draft,
    }],
    commitment: [{ id: COMMITMENT, org_id: ORG, client_id: CLIENT }],
    client_contact: [{ id: CLIENT, org_id: ORG, email: "parent@example.com", ...overrides.client }],
  };
}

beforeEach(() => { vi.mocked(logAudit).mockClear(); });

// ---------------------------------------------------------------------------

describe("the no-send guarantee", () => {
  const source = readFileSync(join(process.cwd(), "lib", "gmail", "client.ts"), "utf8");

  it("has no send reference anywhere in the only module that builds a Gmail URL", () => {
    expect(source).not.toMatch(/send/i);
  });

  it("exposes exactly two endpoints, neither of which can post a message", () => {
    expect(Object.keys(GMAIL_ENDPOINTS)).toEqual(["createDraft", "getDraft"]);
    expect(GMAIL_ENDPOINTS.createDraft)
      .toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(GMAIL_ENDPOINTS.getDraft)
      .toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts/{id}");
  });
});

describe("createGmailClient", () => {
  function clientWith(responses: Response[], waited: number[] = []) {
    const calls: { url: string; init: RequestInit }[] = [];
    const queue = [...responses];
    const client = createGmailClient(TOKEN, {
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return queue.shift() ?? new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
      wait: async (ms: number) => { waited.push(ms); },
    });
    return { client, calls };
  }

  const ok = () => new Response(
    JSON.stringify({ id: "gmail-draft-1", message: { id: "gmail-message-1" } }),
    { status: 200 },
  );

  it("posts the raw message to the drafts endpoint and returns both ids", async () => {
    const { client, calls } = clientWith([ok()]);
    const result = await client.createDraft("cmF3");

    expect(result).toEqual({ draftId: "gmail-draft-1", messageId: "gmail-message-1" });
    expect(calls[0].url).toBe(GMAIL_ENDPOINTS.createDraft);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ message: { raw: "cmF3" } });
  });

  it("carries the access token as a bearer credential", async () => {
    const { client, calls } = clientWith([ok()]);
    await client.createDraft("cmF3");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("maps a revoked grant to GmailInvalidGrantError under 401", async () => {
    const { client } = clientWith([new Response('{"error":"invalid_grant"}', { status: 401 })]);
    await expect(client.createDraft("cmF3")).rejects.toBeInstanceOf(GmailInvalidGrantError);
  });

  it("maps a revoked grant to GmailInvalidGrantError under 403", async () => {
    const { client } = clientWith([new Response('{"error":"invalid_grant"}', { status: 403 })]);
    await expect(client.createDraft("cmF3")).rejects.toBeInstanceOf(GmailInvalidGrantError);
  });

  it("maps a plain 401 to GmailUnauthorizedError", async () => {
    const { client } = clientWith([new Response('{"error":{"code":401}}', { status: 401 })]);
    await expect(client.createDraft("cmF3")).rejects.toBeInstanceOf(GmailUnauthorizedError);
  });

  it("maps a plain 403 to GmailForbiddenError", async () => {
    const { client } = clientWith([new Response('{"error":{"code":403}}', { status: 403 })]);
    await expect(client.createDraft("cmF3")).rejects.toBeInstanceOf(GmailForbiddenError);
  });

  it("retries a 429 and succeeds when the next attempt lands", async () => {
    const waited: number[] = [];
    const { client, calls } = clientWith(
      [new Response("{}", { status: 429, headers: { "retry-after": "3" } }), ok()], waited);

    const result = await client.createDraft("cmF3");
    expect(result.draftId).toBe("gmail-draft-1");
    expect(calls).toHaveLength(2);
    expect(waited).toEqual([3000]);
  });

  it("gives up on a 429 after its retries and reports the delay Gmail asked for", async () => {
    const waited: number[] = [];
    const throttled = () => new Response("{}", { status: 429, headers: { "retry-after": "2" } });
    const { client, calls } = clientWith([throttled(), throttled(), throttled()], waited);

    const failure = await client.createDraft("cmF3").catch((e) => e);
    expect(failure).toBeInstanceOf(GmailRateLimitError);
    expect((failure as GmailRateLimitError).retryAfterSeconds).toBe(2);
    expect(calls).toHaveLength(3);
    expect(waited).toEqual([2000, 2000]);
  });

  it("retries a 5xx and then reports GmailServerError", async () => {
    const boom = () => new Response("upstream exploded", { status: 503 });
    const { client, calls } = clientWith([boom(), boom(), boom()]);

    await expect(client.createDraft("cmF3")).rejects.toBeInstanceOf(GmailServerError);
    expect(calls).toHaveLength(3);
  });

  it("never puts the access token in an error message", async () => {
    const { client } = clientWith([new Response('{"error":{"code":403}}', { status: 403 })]);
    const failure = await client.createDraft("cmF3").catch((e: Error) => e) as Error;
    expect(failure.message).not.toContain(TOKEN);
  });

  it("reports a draft Gmail no longer has as gone rather than throwing", async () => {
    const { client } = clientWith([new Response("", { status: 404 })]);
    expect(await client.getDraft("gmail-draft-1")).toEqual({ exists: false });
  });

  it("reports a draft Gmail still has as present", async () => {
    const { client } = clientWith([new Response("{}", { status: 200 })]);
    expect(await client.getDraft("gmail-draft-1")).toEqual({ exists: true });
  });
});

describe("pushDraftToGmail", () => {
  it("creates the Gmail draft and records where it landed", async () => {
    const tables = seed();
    const gmail = new FakeGmailClient();
    const now = new Date("2026-08-12T10:00:00.000Z");

    const result = await pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test", now }, gmail);

    expect(result.outcome).toBe("pushed");
    expect(result.providerDraftId).toBe("gmail-draft-1");

    const row = tables.deliverable_draft[0];
    expect(row.provider).toBe("gmail");
    expect(row.provider_draft_id).toBe("gmail-draft-1");
    expect(row.provider_message_id).toBe("gmail-message-1");
    expect(row.pushed_at).toBe(now.toISOString());
    expect(row.pushed_by).toBe(USER);
  });

  it("addresses the draft to the client on the commitment", async () => {
    const gmail = new FakeGmailClient();
    await pushDraftToGmail(
      fakeDb(seed()), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail);

    const mime = Buffer.from(gmail.created[0], "base64url").toString("utf8");
    expect(mime).toContain("To: parent@example.com");
    expect(mime).toContain("From: owner@demo.test");
  });

  it("audits the push with the hash of the exact bytes handed to Gmail", async () => {
    const gmail = new FakeGmailClient();
    await pushDraftToGmail(
      fakeDb(seed()), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail);

    expect(logAudit).toHaveBeenCalledWith({
      orgId: ORG, actor: "agent", action: "create",
      target: `deliverable_draft:${DRAFT}:gmail_push`,
      payloadHash: hashRawMessage(gmail.created[0]),
    });
  });

  it("does nothing when the row already points at a live Gmail draft", async () => {
    const tables = seed({ draft: { provider: "gmail", provider_draft_id: "gmail-draft-1" } });
    const gmail = new FakeGmailClient({ exists: true });

    const result = await pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail);

    expect(result.outcome).toBe("already_pushed");
    expect(gmail.created).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("replaces a recorded draft that has since been deleted in Gmail", async () => {
    const tables = seed({ draft: { provider: "gmail", provider_draft_id: "stale-draft" } });
    const gmail = new FakeGmailClient({ exists: false, draftId: "gmail-draft-2" });

    const result = await pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail);

    expect(result.outcome).toBe("recreated");
    expect(gmail.fetched).toEqual(["stale-draft"]);
    expect(tables.deliverable_draft[0].provider_draft_id).toBe("gmail-draft-2");
  });

  it("creates an unaddressed Gmail draft when the client has no email", async () => {
    const tables = seed({ client: { email: null } });
    const gmail = new FakeGmailClient();

    const result = await pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail);

    expect(result.outcome).toBe("pushed");
    expect(gmail.created).toHaveLength(1);
    const mime = Buffer.from(gmail.created[0], "base64url").toString("utf8");
    expect(mime).toContain("To: \r\n");
    expect(mime).toContain("Subject: ");
    const encodedBody = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "");
    expect(encodedBody).toBe(Buffer.from("Confirming the revised set lands Friday.", "utf8")
      .toString("base64"));
    expect(tables.deliverable_draft[0].provider_draft_id).toBe("gmail-draft-1");
    expect(logAudit).toHaveBeenCalledOnce();
  });

  it("leaves the provider columns null when Gmail throttles the push", async () => {
    const tables = seed();
    const gmail = new FakeGmailClient({
      failWith: new GmailRateLimitError("throttled", 429, 30),
    });

    await expect(pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail))
      .rejects.toBeInstanceOf(GmailRateLimitError);

    const row = tables.deliverable_draft[0];
    expect(row.provider_draft_id).toBeNull();
    expect(row.pushed_at).toBeNull();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("throws when the draft row does not exist", async () => {
    await expect(pushDraftToGmail(
      fakeDb(seed()), { draftId: "missing", orgId: ORG, userId: USER, from: "owner@demo.test" },
      new FakeGmailClient())).rejects.toThrow(/not found/i);
  });

  it("requires an access token when no client is injected", async () => {
    await expect(pushDraftToGmail(
      fakeDb(seed()), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }))
      .rejects.toThrow(/access token/i);
  });

  const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";

  it("refuses a draft that does not belong to the caller's own org", async () => {
    await expect(pushDraftToGmail(
      fakeDb(seed()),
      { draftId: DRAFT, orgId: OTHER_ORG, userId: USER, from: "owner@demo.test" },
      new FakeGmailClient()),
    ).rejects.toThrow(/does not belong/i);
  });

  it("refuses to push when the draft's commitment belongs to a foreign org", async () => {
    // The draft itself is in ORG (passes the direct org check), but its commitment_id has
    // been pointed at a commitment that actually lives in a different org — the forged-row
    // shape from the cross-org leak this closes.
    const tables = seed();
    tables.commitment[0].org_id = OTHER_ORG;
    const gmail = new FakeGmailClient();

    await expect(pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail))
      .rejects.toThrow(/does not belong/i);
    expect(gmail.created).toHaveLength(0);
  });

  it("does not create a second Gmail draft when two pushes race on the same row", async () => {
    const tables = seed();
    const gmail = new FakeGmailClient();
    const db = fakeDb(tables);

    const [first, second] = await Promise.all([
      pushDraftToGmail(db, { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail),
      pushDraftToGmail(db, { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["already_pushed", "pushed"]);
    expect(gmail.created).toHaveLength(1);
  });

  it("releases the claim so a throttled push can be retried", async () => {
    const tables = seed();
    const gmail = new FakeGmailClient({ failWith: new GmailRateLimitError("throttled", 429, 1) });

    await expect(pushDraftToGmail(
      fakeDb(tables), { draftId: DRAFT, orgId: ORG, userId: USER, from: "owner@demo.test" }, gmail),
    ).rejects.toBeInstanceOf(GmailRateLimitError);

    expect(tables.deliverable_draft[0].provider_draft_id).toBeNull();
  });
});
