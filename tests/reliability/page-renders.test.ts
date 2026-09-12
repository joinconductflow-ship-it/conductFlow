import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { getServerClient } from "@/lib/db/server";
import { getCurrentOrgId } from "@/lib/db/queries";
import { DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import Reviews from "@/app/(app)/reviews/page";
import Billing from "@/app/(app)/billing/page";
import Documents from "@/app/(app)/documents/page";
import Scheduling from "@/app/(app)/scheduling/page";
import Retainers from "@/app/(app)/retainers/page";
import Leads from "@/app/(app)/leads/page";
import Risk from "@/app/(app)/risk/page";
import Queue from "@/app/(app)/queue/page";
import Tasks from "@/app/(app)/tasks/page";
import ROI from "@/app/(app)/roi/page";
import Ingest from "@/app/(app)/ingest/page";
import Scope from "@/app/(app)/scope/page";
import Reports from "@/app/(app)/reports/page";
import Settings from "@/app/(app)/settings/page";
import Blueprint from "@/app/(app)/settings/blueprint/page";
import DraftReview from "@/app/(app)/queue/[commitmentId]/page";
import Layout from "@/app/(app)/layout";
import Onboarding from "@/app/(app)/onboarding/page";

vi.mock("@/lib/db/server", () => ({ getServerClient: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/reviews",
}));

type Row = Record<string, unknown>;
const ORG = "00000000-0000-0000-0000-00000000000a";
const ID = "00000000-0000-0000-0000-000000000001";
const DATE = "2026-09-01T12:00:00.000Z";
const fault = { code: "42P01", message: "private database failure", details: "missing relation", hint: "check migration" };
let failing: Set<string>;
let rejects: boolean;
let rows: Record<string, Row[]>;
let auth: ReturnType<typeof vi.fn>;
let queries: { table: string; columns: string; filters: [string, unknown][] }[];

function from(table: string) {
  let single = false;
  let columns = "*";
  let offset = 0;
  let limit = Infinity;
  const filters: [string, unknown][] = [];
  const builder = {
    select(value: string) { columns = value; return builder; },
    eq(key: string, value: unknown) { filters.push([key, value]); return builder; },
    neq() { return builder; },
    in() { return builder; },
    is() { return builder; },
    order() { return builder; },
    limit(count: number) { limit = count; return builder; },
    range(start: number, end: number) { offset = start; limit = end - start + 1; return builder; },
    single() { single = true; return builder; },
    maybeSingle() { single = true; return builder; },
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      queries.push({ table, columns, filters });
      const failed = failing.has(table) || failing.has(`${table}:${columns}`) || failing.has(`${table}:offset:${offset}`);
      if (failed && rejects) return Promise.reject(new Error("transport failed", { cause: fault })).then(resolve, reject);
      let selected = rows[table] ?? [];
      // Tenant, identity and kind filters are honored; fixtures contain columns used by joins.
      selected = selected.filter((row) => filters.every(([key, value]) => row[key] === value));
      selected = selected.slice(offset, offset + limit);
      return Promise.resolve({ data: failed ? null : single ? selected[0] ?? null : selected,
        error: failed ? fault : null }).then(resolve, reject);
    },
  };
  return builder;
}

beforeEach(() => {
  failing = new Set(); rejects = false; queries = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth = vi.fn().mockResolvedValue({ data: { user: { id: ID, email: "owner@example.test" } }, error: null });
  const base = { id: ID, org_id: ORG, client_id: ID, created_at: DATE };
  rows = {
    membership: [{ ...base, user_id: ID, role: "owner" }],
    client_contact: [{ ...base, name: "Healthy client", kind: null }],
    client_message_draft: ["review_request", "document_reminder", "reschedule_offer", "retainer_renewal", "invoice"].map((kind) =>
      ({ ...base, kind, source_id: ID, subject: "Healthy draft", body: "Draft body" })),
    received_review: [{ ...base, reviewer_name: "Healthy reviewer", source: "other", rating: 5, raw_review: "Great", sentiment: "positive", urgency: "low", status: "new" }],
    commitment: [{ ...base, conversation_id: ID, text: "Healthy commitment", owner: "Alex", deadline: DATE, type: "follow_up", confidence: "high", source_span: "I will follow up", status: "proposed", source_flagged: false }],
    transcript: [{ ...base, conversation_id: ID, injection_flags: [], extraction_status: "failed", conversation: { title: "Healthy transcript" }, extraction_error: "Parsing failed" }],
    deliverable_draft: [{ ...base, commitment_id: ID, kind: "email", subject: "Healthy deliverable", body: "Draft body" }],
    commitment_action_suggestion: [{ ...base, commitment_id: ID, action_type: "gmail_draft",
      confidence: "high", rationale: "A follow-up should be drafted", required_data: ["body"],
      missing_data: [] }],
    task: [{ ...base, commitment_id: ID, title: "Healthy task", status: "open", due: DATE, completed_at: null, commitment: { client_contact: { name: "Healthy client" } } }],
    reminder: [{ ...base, task_id: ID, due_at: DATE, state: "open", task: { title: "Healthy reminder" } }],
    escalation: [{ ...base, conversation_id: ID, commitment_id: ID, state: "open", kind: "complaint", detail: "Healthy escalation", severity: "warn", conversation: { title: "Healthy conversation" } }],
    time_entry: [{ ...base, minutes: 60, note: "Healthy time", invoiced: false }],
    invoice: [{ ...base, status: "draft", total_cents: 10000, due_date: DATE }],
    billing_rate: [{ ...base, unit: "hourly", amount_cents: 10000 }],
    document_requirement: [{ ...base, name: "Healthy requirement", description: null }],
    client_document: [{ ...base, requirement_id: ID, status: "received" }],
    scheduled_session: [{ ...base, starts_at: DATE, status: "scheduled", reschedule_offered_at: null }],
    retainer: [{ ...base, label: "Healthy retainer", unit: "hours", total_units: 10, used_units: 1, low_balance_threshold: 2, status: "active", renewal_offered_at: null }],
    prospect: [{ ...base, name: "Healthy prospect", email: null, urgency: "low", status: "new" }],
    prospect_message_draft: [{ ...base, prospect_id: ID, kind: "lead_reply", subject: "Healthy lead draft", body: "Reply" }],
    payment_risk_flag: [{ ...base, invoice_id: ID, signal: "invoice_due_quiet", evidence: "Healthy risk", related_draft_id: ID, status: "open" }],
    scope_of_work: [{ ...base, summary: "Healthy agreed scope" }],
    agent_blueprint: [{ ...base, ...DEFAULT_BLUEPRINT, version: 1 }],
    connected_data_source_public: [{ ...base, account_email: "owner@example.test", scopes: [], state: "active" }],
  };
  vi.mocked(getServerClient).mockResolvedValue({ from, auth: { getUser: auth } } as unknown as Awaited<ReturnType<typeof getServerClient>>);
});
afterEach(() => vi.restoreAllMocks());

const pages = [
  { route: "/reviews", render: Reviews, tables: ["client_message_draft", "received_review", "client_contact"] },
  { route: "/billing", render: Billing, tables: ["client_contact", "time_entry", "invoice", "client_message_draft"] },
  { route: "/documents", render: Documents, tables: ["client_contact", "document_requirement", "client_document", "client_message_draft"] },
  { route: "/scheduling", render: Scheduling, tables: ["client_contact", "scheduled_session", "client_message_draft"] },
  { route: "/retainers", render: Retainers, tables: ["client_contact", "retainer", "client_message_draft"] },
  { route: "/leads", render: Leads, tables: ["prospect", "prospect_message_draft"] },
  { route: "/risk", render: Risk, tables: ["payment_risk_flag", "client_contact", "client_message_draft"] },
  { route: "/queue", render: Queue, tables: ["commitment", "transcript", "escalation"] },
  { route: "/tasks", render: Tasks, tables: ["task", "reminder", "commitment", "client_contact"] },
  { route: "/roi", render: ROI, tables: ["commitment", "task", "client_contact"] },
  { route: "/ingest", render: Ingest, tables: ["client_contact"] },
  { route: "/scope", render: Scope, tables: ["client_contact", "scope_of_work", "membership:role"] },
  { route: "/reports", render: Reports, tables: ["time_entry", "invoice", "client_contact", "billing_rate"] },
  { route: "/settings", render: () => Settings({ searchParams: Promise.resolve({}) }), tables: ["connected_data_source_public"] },
  { route: "/settings/blueprint", render: Blueprint, tables: ["agent_blueprint", "membership:role"] },
  { route: "/queue/[commitmentId]", render: () => DraftReview({ params: Promise.resolve({ commitmentId: ID }) }), tables: ["commitment", "deliverable_draft", "transcript", "commitment_action_suggestion"] },
];

it("covers every page and layout under app/(app)", () => {
  const files = readdirSync(resolve("app/(app)"), { recursive: true })
    .map(String).filter((file) => /(?:^|\/)(page|layout)\.tsx$/.test(file)).sort();
  const covered = [
    "layout.tsx", "onboarding/page.tsx",
    // Nested layout wraps a client-only CopilotKitProvider; rendering the page here would
    // need that provider mocked for no reliability benefit, so it's excluded rather than
    // faked into the fault-injection matrix below.
    "copilot/layout.tsx", "copilot/page.tsx",
    ...pages.map(({ route }) => `${route.slice(1)}/page.tsx`),
  ].sort();
  expect(files).toEqual(covered);
});

describe.each(pages)("$route server render", ({ route, render, tables }) => {
  it("renders healthy data without a fallback", async () => {
    const html = renderToStaticMarkup(await render());
    expect(html).toContain("<main");
    expect(html).not.toContain("temporarily unavailable");
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each(tables.flatMap((table) => [false, true].map((rejected) => ({ table, rejected }))))(
    "isolates $table failure (rejected=$rejected)", async ({ table, rejected }) => {
      failing.add(table); rejects = rejected;
      const html = renderToStaticMarkup(await render());
      expect(html).toContain("<main");
      expect(html).toContain("temporarily unavailable");
      expect(html).not.toContain(fault.message);
      const logs = vi.mocked(console.error).mock.calls.flat().join(" ");
      expect(logs).toContain(route);
      expect(logs).toContain(table.split(":")[0]);
      expect(logs).toContain(fault.code);
    },
  );
});

describe("independent sections and safe fallbacks", () => {
  it("keeps received reviews when drafts fail, and keeps drafts when received reviews fail", async () => {
    failing.add("client_message_draft");
    let html = renderToStaticMarkup(await Reviews());
    expect(html).toContain("Healthy reviewer");
    expect(html).not.toContain("Nothing pending");
    failing = new Set(["received_review"]);
    html = renderToStaticMarkup(await Reviews());
    expect(html).toContain("Healthy draft");
    expect(html).toContain("Draft response");
    expect(html).not.toContain("No reviews yet");
  });
  it("handles both review tables failing and skips the dependent name lookup", async () => {
    failing = new Set(["client_message_draft", "received_review"]);
    const html = renderToStaticMarkup(await Reviews());
    expect(html.match(/temporarily unavailable/g)).toHaveLength(2);
    expect(queries.some((query) => query.table === "client_contact")).toBe(false);
  });
  it("uses a generic client name when lookup fails without dropping drafts", async () => {
    failing.add("client_contact");
    expect(renderToStaticMarkup(await Reviews())).toContain("Healthy draft");
  });
  it("keeps invoice data visible when time entries fail", async () => {
    failing.add("time_entry");
    const html = renderToStaticMarkup(await Billing());
    expect(html).toContain("$100.00");
    expect(html).not.toContain("No un-invoiced time");
  });
  it("does not label unreadable document statuses as unassigned", async () => {
    failing.add("client_document");
    const html = renderToStaticMarkup(await Documents());
    expect(html).toContain("Healthy requirement");
    expect(html).not.toContain("not assigned");
  });
  it("keeps the task board when recurring data fails", async () => {
    failing.add("commitment");
    const html = renderToStaticMarkup(await Tasks());
    expect(html).toContain("Healthy task");
    expect(html).toContain("Recurring suggestions are temporarily unavailable");
  });
  it.each(["scope_of_work", "membership:role"])("does not allow saving unloaded scope or permissions: %s", async (table) => {
    failing.add(table);
    expect(renderToStaticMarkup(await Scope())).not.toContain("Save scope");
  });
  it("does not present a failed blueprint as shipped defaults", async () => {
    failing.add("agent_blueprint");
    const html = renderToStaticMarkup(await Blueprint());
    expect(html).not.toContain("shipped defaults");
    expect(html).not.toContain("<form");
  });
  it.each(["deliverable_draft", "transcript"])("does not offer approval without %s", async (table) => {
    failing.add(table);
    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("Healthy commitment");
    expect(html).not.toContain("Approve");
  });
  it("does not offer approval when detected actions cannot be read", async () => {
    failing.add("commitment_action_suggestion");
    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("Detected actions are temporarily unavailable");
    expect(html).not.toContain("Approve action");
  });
  it("renders only persisted suggestions and shows missing-data state", async () => {
    rows.commitment_action_suggestion = [{
      id: ID, org_id: ORG, commitment_id: ID, action_type: "calendar_event",
      confidence: "medium", rationale: "Schedule the promised check-in",
      required_data: ["start_time"], missing_data: ["start_time"], created_at: DATE,
    }];
    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("Create event");
    expect(html).toContain("Needs info");
    expect(html).not.toContain("Create draft");
    expect(html).not.toContain("Track commitment");
  });

  it("exposes the relative-date confirmation a persisted calendar action requires", async () => {
    rows.commitment_action_suggestion = [{
      id: ID, org_id: ORG, commitment_id: ID, action_type: "calendar_event",
      confidence: "high", rationale: "Schedule the promised meeting",
      required_data: ["start_time"], missing_data: ["relative_date_confirmation"],
      input_data: {
        date: "2026-09-15", start_time: "16:00", duration_minutes: 60,
        relative_date: true, event_type: "Meeting", person: "Client",
      },
      created_at: DATE,
    }];

    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("Confirm interpreted date");
    expect(html).toContain("Needs confirmation");
    // The persisted, server-normalized value is what the card shows, not a stale local copy.
    expect(html).toContain('value="16:00"');
  });

  it("shows a recipient-less Gmail draft as ready when its content exists", async () => {
    rows.commitment_action_suggestion = [{
      ...rows.commitment_action_suggestion[0],
      required_data: ["recipient", "subject", "body"],
      missing_data: ["recipient"],
    }];

    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("Create draft");
    expect(html).toContain("Ready");
    expect(html).not.toContain("Needs info");
    expect(html).not.toContain("Draft required");
  });

  it("shows a retry-oriented empty state when a Gmail draft is missing", async () => {
    rows.deliverable_draft = [];

    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("Draft generation did not finish");
    expect(html).toContain("Try writing the draft again");
    expect(html).toContain("Draft required");
    expect(html).not.toContain("Needs info");
  });

  it("does not claim draft generation failed for a non-Gmail commitment", async () => {
    rows.deliverable_draft = [];
    rows.commitment_action_suggestion = [{
      ...rows.commitment_action_suggestion[0],
      action_type: "internal_task",
      rationale: "Track the internal work.",
      required_data: ["task_title"],
      missing_data: [],
    }];

    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).toContain("No email draft was requested for this commitment");
    expect(html).not.toContain("Draft generation did not finish");
    expect(html).not.toContain("draft call did not succeed");
  });
  it("does not call a query outage a missing commitment", async () => {
    failing.add("commitment");
    const html = renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) }));
    expect(html).not.toContain("That commitment is not here");
  });
  it("still reports a genuinely missing commitment", async () => {
    rows.commitment = [];
    expect(renderToStaticMarkup(await DraftReview({ params: Promise.resolve({ commitmentId: ID }) })))
      .toContain("That commitment is not here");
  });
  it("does not publish a partial financial rollup when a later page fails", async () => {
    rows.time_entry = Array.from({ length: 1000 }, (_, i) => ({ ...rows.time_entry[0], id: String(i) }));
    failing.add("time_entry:offset:1000");
    const html = renderToStaticMarkup(await Reports());
    expect(html).toContain("Client utilization is temporarily unavailable");
    expect(html).not.toContain("<table");
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toContain("offset 1000");
  });
  it("does not claim disconnected integrations when their metadata cannot load", async () => {
    failing.add("connected_data_source_public");
    const html = renderToStaticMarkup(await Settings({ searchParams: Promise.resolve({ error: "Useful action error" }) }));
    expect(html).toContain("Useful action error");
    expect(html).toContain("Review the blueprint");
    expect(html).toContain("Google connections are temporarily unavailable");
  });
});

describe("auth and configuration classification", () => {
  it("treats absent sessions as signed out", async () => {
    auth.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect(renderToStaticMarkup(await Reviews())).toContain("Sign in to see review requests");
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each([false, true])("preserves critical auth failures (rejected=%s)", async (rejected) => {
    if (rejected) auth.mockRejectedValue(new Error("auth offline"));
    else auth.mockResolvedValue({ data: { user: null }, error: new Error("auth offline") });
    await expect(Reviews()).rejects.toThrow("Unable to verify your session");
    expect(queries).toEqual([]);
  });
  it("preserves critical membership failures for pages and actions", async () => {
    failing.add("membership:org_id");
    await expect(Reviews()).rejects.toThrow("Unable to load your workspace");
    await expect(getCurrentOrgId()).rejects.toThrow("Unable to load your workspace");
    expect(queries.every((query) => query.table === "membership")).toBe(true);
  });
  it("preserves core client configuration failures", async () => {
    vi.mocked(getServerClient).mockRejectedValue(new Error("NEXT_PUBLIC_SUPABASE_URL not set."));
    await expect(Reviews()).rejects.toThrow("NEXT_PUBLIC_SUPABASE_URL not set.");
  });
  it.each([Scope, Blueprint])("denies editor access when the second auth read fails", async (render) => {
    auth.mockResolvedValueOnce({ data: { user: { id: ID } }, error: null })
      .mockRejectedValueOnce(new Error("auth offline"));
    const html = renderToStaticMarkup(await render());
    expect(html).toContain("Editing permissions are temporarily unavailable");
    expect(queries.filter((query) => query.columns === "role")).toEqual([]);
    expect(html).not.toContain("Save scope");
  });
  it("keeps onboarding reachable when navigation auth fails", async () => {
    auth.mockRejectedValue(new Error("auth offline"));
    const onboarding = await Onboarding({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(await Layout({ children: onboarding }));
    expect(html).toContain("Set up your workspace");
    expect(html).toContain("Account navigation is temporarily unavailable");
  });
  it("renders signed-in navigation", async () => {
    expect(renderToStaticMarkup(await Layout({ children: createElement("main", null, "Child") })))
      .toContain("owner@example.test");
  });
});
