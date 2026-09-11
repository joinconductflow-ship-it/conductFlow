import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/agent/blueprint-store", () => ({ contractFor: vi.fn() }));
vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn() }));

import { resolvePaymentRiskFlag, scanPaymentRisks } from "@/lib/payments/risk";
import { blueprintToContract, DEFAULT_BLUEPRINT } from "@/lib/agent/blueprint";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

const ORG = "org-a", OTHER_ORG = "org-b";
const CLIENT = "client-a", OTHER_CLIENT = "client-b";
const NOW = new Date("2026-09-10T12:00:00.000Z");
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables): SupabaseClient {
  const rows = (table: string) => tables[table] ?? (tables[table] = []);
  let sequence = 0;
  return {
    from(table: string) {
      function chain(matchers: Array<(row: Row) => boolean> = [], patch?: Row,
        sort?: string, slice?: [number, number]) {
        function run() {
          let matched = rows(table).filter((row) => matchers.every((matcher) => matcher(row)));
          if (sort) matched = [...matched].sort((a, b) => String(a[sort]).localeCompare(String(b[sort])));
          if (slice) matched = matched.slice(slice[0], slice[1] + 1);
          if (patch) matched.forEach((row) => Object.assign(row, patch));
          return { data: matched.map((row) => ({ ...row })), error: null };
        }
        return {
          select() { return chain(matchers, patch, sort, slice); },
          eq(column: string, value: unknown) {
            return chain([...matchers, (row) => row[column] === value], patch, sort, slice);
          },
          is(column: string, value: unknown) {
            return chain([...matchers, (row) => (row[column] ?? null) === value], patch, sort, slice);
          },
          not(column: string, operator: string, value: unknown) {
            if (operator !== "is") throw new Error(`unsupported operator ${operator}`);
            return chain([...matchers, (row) => (row[column] ?? null) !== value], patch, sort, slice);
          },
          in(column: string, values: unknown[]) {
            return chain([...matchers, (row) => values.includes(row[column])], patch, sort, slice);
          },
          lt(column: string, value: string) {
            return chain([...matchers, (row) => typeof row[column] === "string" && row[column] < value], patch, sort, slice);
          },
          gte(column: string, value: string) {
            return chain([...matchers, (row) => typeof row[column] === "string" && row[column] >= value], patch, sort, slice);
          },
          order(column: string) { return chain(matchers, patch, column, slice); },
          range(from: number, to: number) { return chain(matchers, patch, sort, [from, to]); },
          async maybeSingle() {
            const result = run();
            return { ...result, data: result.data[0] ?? null };
          },
          then(resolve: (value: { data: Row[]; error: null }) => unknown) {
            return Promise.resolve(run()).then(resolve);
          },
        };
      }
      return {
        select() { return chain(); },
        update(patch: Row) { return chain([], patch); },
        insert(row: Row) {
          const inserted = { id: `generated-${sequence++}`, ...row };
          rows(table).push(inserted);
          return {
            select() {
              return { async single() { return { data: { ...inserted }, error: null }; } };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function emptyTables(): Tables {
  return {
    client_message_draft: [], client_document: [], document_requirement: [], task: [],
    commitment: [], invoice: [], time_entry: [], payment_risk_flag: [],
    client_contact: [
      { id: CLIENT, org_id: ORG, name: "Jordan" },
      { id: OTHER_CLIENT, org_id: ORG, name: "Casey" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contractFor).mockResolvedValue(blueprintToContract(DEFAULT_BLUEPRINT));
});

describe("scanPaymentRisks", () => {
  it("flags an unsent change order older than three days but ignores a fresh one", async () => {
    const tables = emptyTables();
    tables.client_message_draft.push(
      { id: "draft-old", org_id: ORG, client_id: CLIENT, kind: "change_order",
        provider_draft_id: null, created_at: "2026-09-06T11:00:00.000Z" },
      { id: "draft-fresh", org_id: ORG, client_id: CLIENT, kind: "change_order",
        provider_draft_id: null, created_at: "2026-09-09T11:00:00.000Z" },
    );

    expect(await scanPaymentRisks(fakeDb(tables), { orgId: ORG, now: NOW }))
      .toEqual({ flagged: 1, alreadyOpen: 0 });
    expect(tables.payment_risk_flag).toEqual([expect.objectContaining({
      signal: "unsent_change_order", related_draft_id: "draft-old", invoice_id: null,
    })]);
  });

  it("flags a missing document only when that client has an open invoice", async () => {
    const tables = emptyTables();
    tables.document_requirement.push({ id: "requirement-w9", org_id: ORG, name: "Signed W-9" });
    tables.client_document.push(
      { id: "document-a", org_id: ORG, client_id: CLIENT,
        requirement_id: "requirement-w9", status: "missing" },
      { id: "document-b", org_id: ORG, client_id: OTHER_CLIENT,
        requirement_id: "requirement-w9", status: "missing" },
    );
    tables.invoice.push({ id: "invoice-a", org_id: ORG, client_id: CLIENT,
      status: "sent", due_date: "2026-09-20" });

    await scanPaymentRisks(fakeDb(tables), { orgId: ORG, now: NOW });
    expect(tables.payment_risk_flag).toEqual([expect.objectContaining({
      client_id: CLIENT, signal: "missing_document", invoice_id: "invoice-a",
      evidence: expect.stringContaining("Signed W-9"),
    })]);
  });

  it("flags an overdue unfinished delivery but ignores a done task", async () => {
    const tables = emptyTables();
    tables.commitment.push({ id: "commitment-a", org_id: ORG, client_id: CLIENT });
    tables.task.push(
      { id: "task-open", org_id: ORG, commitment_id: "commitment-a", title: "Ship final files",
        due: "2026-09-08T12:00:00.000Z", done: false },
      { id: "task-done", org_id: ORG, commitment_id: "commitment-a", title: "Already delivered",
        due: "2026-09-08T12:00:00.000Z", done: true },
    );
    tables.invoice.push({ id: "invoice-a", org_id: ORG, client_id: CLIENT,
      status: "overdue", due_date: "2026-09-09" });

    await scanPaymentRisks(fakeDb(tables), { orgId: ORG, now: NOW });
    expect(tables.payment_risk_flag).toEqual([expect.objectContaining({
      signal: "delivery_overdue", evidence: expect.stringContaining("Ship final files"),
    })]);
    expect(tables.payment_risk_flag[0].evidence).toContain("2 days overdue");
  });

  it("flags a quiet soon-due invoice and creates a hardcoded check-in draft", async () => {
    const tables = emptyTables();
    tables.invoice.push(
      { id: "invoice-quiet", org_id: ORG, client_id: CLIENT, status: "sent", due_date: "2026-09-12" },
      { id: "invoice-active", org_id: ORG, client_id: OTHER_CLIENT, status: "sent", due_date: "2026-09-12" },
    );
    tables.time_entry.push({ id: "time-recent", org_id: ORG, client_id: OTHER_CLIENT,
      created_at: "2026-09-09T12:00:00.000Z" });

    expect(await scanPaymentRisks(fakeDb(tables), { orgId: ORG, now: NOW }))
      .toEqual({ flagged: 1, alreadyOpen: 0 });
    expect(tables.client_message_draft).toEqual([expect.objectContaining({
      kind: "payment_risk_checkin", source_id: "invoice-quiet",
      subject: "Quick check-in before your invoice is due",
      body: expect.stringContaining("Hi Jordan"),
    })]);
    expect(tables.payment_risk_flag[0]).toMatchObject({ signal: "invoice_due_quiet",
      invoice_id: "invoice-quiet", related_draft_id: tables.client_message_draft[0].id });
  });

  it("does not create a duplicate when the same flag is already open", async () => {
    const tables = emptyTables();
    tables.client_message_draft.push({ id: "draft-old", org_id: ORG, client_id: CLIENT,
      kind: "change_order", provider_draft_id: null, created_at: "2026-09-01T12:00:00.000Z" });
    const db = fakeDb(tables);
    expect(await scanPaymentRisks(db, { orgId: ORG, now: NOW })).toEqual({ flagged: 1, alreadyOpen: 0 });
    expect(await scanPaymentRisks(db, { orgId: ORG, now: NOW })).toEqual({ flagged: 0, alreadyOpen: 1 });
    expect(tables.payment_risk_flag).toHaveLength(1);
  });

  it("still raises the quiet-invoice flag when blueprint policy denies its draft", async () => {
    vi.mocked(contractFor).mockResolvedValue(blueprintToContract({
      ...DEFAULT_BLUEPRINT,
      permitted_actions: DEFAULT_BLUEPRINT.permitted_actions
        .filter((action) => action !== "draft_payment_risk_checkin"),
    }));
    const tables = emptyTables();
    tables.invoice.push({ id: "invoice-quiet", org_id: ORG, client_id: CLIENT,
      status: "sent", due_date: "2026-09-11" });

    await scanPaymentRisks(fakeDb(tables), { orgId: ORG, now: NOW });
    expect(tables.payment_risk_flag).toEqual([expect.objectContaining({
      signal: "invoice_due_quiet", related_draft_id: null,
      evidence: expect.stringContaining("denied by blueprint policy"),
    })]);
    expect(tables.client_message_draft).toHaveLength(0);
  });
});

describe("resolvePaymentRiskFlag", () => {
  it("updates a same-org flag and audits the human action", async () => {
    const tables = emptyTables();
    tables.payment_risk_flag.push({ id: "flag-a", org_id: ORG, status: "open" });
    await resolvePaymentRiskFlag(fakeDb(tables), { orgId: ORG, flagId: "flag-a", next: "resolved" });
    expect(tables.payment_risk_flag[0].status).toBe("resolved");
    expect(logAudit).toHaveBeenCalledWith({ orgId: ORG, actor: "human", action: "update",
      target: "payment_risk_flag:flag-a:resolved" });
  });

  it("throws for a missing flag or a flag in another organization", async () => {
    const tables = emptyTables();
    tables.payment_risk_flag.push({ id: "flag-b", org_id: OTHER_ORG, status: "open" });
    const db = fakeDb(tables);
    await expect(resolvePaymentRiskFlag(db, { orgId: ORG, flagId: "missing", next: "dismissed" }))
      .rejects.toThrow("payment risk flag not found");
    await expect(resolvePaymentRiskFlag(db, { orgId: ORG, flagId: "flag-b", next: "dismissed" }))
      .rejects.toThrow("payment risk flag not found");
  });
});
