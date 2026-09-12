import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashToken, generateToken } from "@/lib/auth/desktop-token";

/**
 * Route-level coverage for the desktop API: who gets in, what is rejected, and what
 * the caller is told. The extraction and ingest themselves are covered by their own
 * suites — these tests are about the door, not the room behind it.
 */

const extractCommitments = vi.fn();
const runIngest = vi.fn();
let tokenRow: Record<string, unknown> | null;
let clientRow: Record<string, unknown> | null;
let lookupError: { message: string } | null;
let inserted: Record<string, unknown>[];

vi.mock("@/lib/agent/extract", () => ({ extractCommitments: (...a: unknown[]) => extractCommitments(...a) }));
vi.mock("@/lib/ingest/run", () => ({ runIngest: (...a: unknown[]) => runIngest(...a) }));
vi.mock("@/lib/db/service", () => ({
  getServiceClient: () => {
    const builder = (table: string) => {
      const chain: Record<string, unknown> = {
        select() { return chain; },
        eq() { return chain; },
        ilike() { return chain; },
        update() { return chain; },
        insert(row: Record<string, unknown>) { inserted.push({ table, ...row }); return chain; },
        single: async () =>
          table === "client_contact"
            ? { data: { id: "client-1", name: "Northwind" }, error: null }
            : { data: null, error: null },
        maybeSingle: async () => {
          if (table === "desktop_token") return { data: tokenRow, error: lookupError };
          if (table === "client_contact") return { data: clientRow, error: lookupError };
          return { data: null, error: null };
        },
        then: undefined,
      };
      return chain;
    };
    return { from: builder };
  },
}));

const TOKEN = generateToken();

beforeEach(() => {
  vi.clearAllMocks();
  inserted = [];
  lookupError = null;
  clientRow = null;
  tokenRow = {
    id: "tok-1", org_id: "org-a", user_id: "user-1",
    token_hash: hashToken(TOKEN), revoked_at: null,
    // Far enough in the past that the throttle never trips in tests.
    last_used_at: new Date(Date.now() - 60_000).toISOString(),
  };
});

function post(url: string, body: unknown, token: string | null = TOKEN) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/capture", () => {
  it("extracts for a valid token and persists nothing", async () => {
    extractCommitments.mockResolvedValue({
      commitments: [{ text: "Send the PDF" }], flagged: [], dropped: 0,
    });
    const { POST } = await import("@/app/api/desktop/capture/route");

    const res = await POST(post("/api/desktop/capture", { text: "Call with Northwind." }));
    expect(res.status).toBe(200);
    expect((await res.json()).commitments).toHaveLength(1);

    // The whole point of a preview: no conversation, no transcript, no draft.
    expect(runIngest).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("refuses a missing, malformed or revoked token", async () => {
    const { POST } = await import("@/app/api/desktop/capture/route");

    expect((await POST(post("/api/desktop/capture", { text: "x" }, null))).status).toBe(401);
    expect((await POST(post("/api/desktop/capture", { text: "x" }, "nonsense"))).status).toBe(401);

    tokenRow = { ...tokenRow!, revoked_at: new Date().toISOString() };
    expect((await POST(post("/api/desktop/capture", { text: "x" }))).status).toBe(401);
  });

  it("treats a token lookup failure as unavailable, never as a pass", async () => {
    lookupError = { message: "connection reset" };
    const { POST } = await import("@/app/api/desktop/capture/route");
    const res = await POST(post("/api/desktop/capture", { text: "x" }));
    expect(res.status).toBe(503);
    expect(extractCommitments).not.toHaveBeenCalled();
  });

  it("rejects empty input and refuses oversized input", async () => {
    const { POST } = await import("@/app/api/desktop/capture/route");
    expect((await POST(post("/api/desktop/capture", { text: "   " }))).status).toBe(400);
    expect((await POST(post("/api/desktop/capture", { text: "x".repeat(400_000) }))).status).toBe(413);
    expect(extractCommitments).not.toHaveBeenCalled();
  });

  it("throttles a token that just called", async () => {
    tokenRow = { ...tokenRow!, last_used_at: new Date().toISOString() };
    const { POST } = await import("@/app/api/desktop/capture/route");
    const res = await POST(post("/api/desktop/capture", { text: "x" }));
    expect(res.status).toBe(429);
    // The throttle exists because this endpoint costs gateway spend.
    expect(extractCommitments).not.toHaveBeenCalled();
  });
});

describe("POST /api/desktop/execute", () => {
  const good = {
    text: "Call with Northwind about the brand refresh.",
    clientName: "Northwind", clientEmail: "priya@northwind.example",
  };

  it("ingests under the token's own org, never one the caller supplied", async () => {
    runIngest.mockResolvedValue({
      conversationId: "conv-1", commitmentCount: 2, draftCount: 2, flagged: [], dropped: 0,
    });
    const { POST } = await import("@/app/api/desktop/execute/route");

    const res = await POST(post("/api/desktop/execute", { ...good, orgId: "org-SOMEONE-ELSE" }));
    expect(res.status).toBe(200);

    const [, args] = runIngest.mock.calls[0] as [unknown, { orgId: string }];
    expect(args.orgId).toBe("org-a");
  });

  it("says plainly that nothing was sent", async () => {
    runIngest.mockResolvedValue({
      conversationId: "c", commitmentCount: 1, draftCount: 1, flagged: [], dropped: 0,
    });
    const { POST } = await import("@/app/api/desktop/execute/route");
    const payload = await (await POST(post("/api/desktop/execute", good))).json();
    expect(payload.status).toMatch(/nothing has been sent/);
  });

  it("requires a real email, because a draft needs somewhere to go", async () => {
    const { POST } = await import("@/app/api/desktop/execute/route");
    for (const clientEmail of ["", "  ", "nope", "no@tld", "@x.com"]) {
      const res = await POST(post("/api/desktop/execute", { ...good, clientEmail }));
      expect(res.status).toBe(400);
    }
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("requires a client name", async () => {
    const { POST } = await import("@/app/api/desktop/execute/route");
    expect((await POST(post("/api/desktop/execute", { ...good, clientName: "" }))).status).toBe(400);
  });

  it("reuses an existing contact rather than duplicating it", async () => {
    clientRow = { id: "client-existing", name: "Northwind", email: "priya@northwind.example" };
    runIngest.mockResolvedValue({
      conversationId: "c", commitmentCount: 0, draftCount: 0, flagged: [], dropped: 0,
    });
    const { POST } = await import("@/app/api/desktop/execute/route");
    await POST(post("/api/desktop/execute", good));

    expect(inserted.filter((r) => r.table === "client_contact")).toHaveLength(0);
  });

  it("does not invent a contact when the lookup itself failed", async () => {
    // Treating an error as "not found" would create a duplicate every time the
    // database hiccuped.
    lookupError = { message: "connection reset" };
    tokenRow = { ...tokenRow! };
    const { POST } = await import("@/app/api/desktop/execute/route");
    const res = await POST(post("/api/desktop/execute", good));
    expect(res.status).toBe(503);
    expect(inserted.filter((r) => r.table === "client_contact")).toHaveLength(0);
  });

  it("reports a blueprint denial as a denial, not a server error", async () => {
    runIngest.mockRejectedValue(new Error("action denied: draft_task_list is switched off"));
    const { POST } = await import("@/app/api/desktop/execute/route");
    const res = await POST(post("/api/desktop/execute", good));
    expect(res.status).toBe(403);
  });
});
