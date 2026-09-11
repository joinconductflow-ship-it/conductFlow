import type { SupabaseClient } from "@supabase/supabase-js";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

export interface ScanPaymentRisksArgs {
  /** Omit to sweep every org — what the cron route does. */
  orgId?: string;
  now?: Date;
  actor?: "agent";
}

export interface ScanPaymentRisksResult {
  flagged: number;
  alreadyOpen: number;
}

export type PaymentRiskSignal =
  | "unsent_change_order"
  | "missing_document"
  | "delivery_overdue"
  | "invoice_due_quiet";

interface ChangeOrderDraft {
  id: string; org_id: string; client_id: string; created_at: string;
}
interface ClientDocument {
  id: string; org_id: string; client_id: string; requirement_id: string;
}
interface Requirement { id: string; name: string }
interface Task {
  id: string; org_id: string; commitment_id: string; title: string; due: string;
}
interface Commitment { id: string; org_id: string; client_id: string | null }
interface Invoice {
  id: string; org_id: string; client_id: string; status: "sent" | "overdue";
  due_date: string | null;
}
interface TimeEntry { org_id: string; client_id: string }
interface Client { id: string; name: string }
interface OpenFlag {
  org_id: string; client_id: string; signal: PaymentRiskSignal;
  invoice_id: string | null; related_draft_id: string | null;
}
interface Candidate {
  orgId: string; clientId: string; signal: PaymentRiskSignal;
  invoiceId: string | null; relatedDraftId: string | null; evidence: string;
}

type PageQuery = PromiseLike<{ data: unknown; error: unknown }>;
const PAGE_SIZE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function pages<T>(build: (from: number, to: number) => PageQuery): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

async function rowsByIds<T extends { id: string; org_id?: string }>(
  db: SupabaseClient, table: string, columns: string, ids: string[], orgId?: string,
): Promise<T[]> {
  const all: T[] = [];
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += PAGE_SIZE) {
    let query = db.from(table).select(columns).in("id", unique.slice(offset, offset + PAGE_SIZE));
    if (orgId) query = query.eq("org_id", orgId);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...((data ?? []) as unknown as T[]));
  }
  return all;
}

function sourceKey(flag: OpenFlag | Candidate): string {
  const orgId = "orgId" in flag ? flag.orgId : flag.org_id;
  const clientId = "clientId" in flag ? flag.clientId : flag.client_id;
  const invoiceId = "invoiceId" in flag ? flag.invoiceId : flag.invoice_id;
  const relatedDraftId = "relatedDraftId" in flag ? flag.relatedDraftId : flag.related_draft_id;
  const source = flag.signal === "unsent_change_order" ? relatedDraftId : invoiceId;
  return `${orgId}:${clientId}:${flag.signal}:${source ?? "none"}`;
}

function clientKey(orgId: string, clientId: string): string {
  return `${orgId}:${clientId}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function overduePhrase(due: string, now: Date): string {
  const days = Math.max(1, Math.ceil((now.getTime() - Date.parse(due)) / DAY_MS));
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

async function fetchInputs(db: SupabaseClient, args: ScanPaymentRisksArgs, now: Date) {
  const oldDraftCutoff = new Date(now.getTime() - 3 * DAY_MS).toISOString();
  const recentCutoff = new Date(now.getTime() - 14 * DAY_MS).toISOString();

  const oldChangeOrders = await pages<ChangeOrderDraft>((from, to) => {
    let query = db.from("client_message_draft").select("id,org_id,client_id,created_at")
      .eq("kind", "change_order").is("provider_draft_id", null).lt("created_at", oldDraftCutoff);
    if (args.orgId) query = query.eq("org_id", args.orgId);
    return query.order("id", { ascending: true }).range(from, to);
  });
  const missingDocuments = await pages<ClientDocument>((from, to) => {
    let query = db.from("client_document").select("id,org_id,client_id,requirement_id")
      .eq("status", "missing");
    if (args.orgId) query = query.eq("org_id", args.orgId);
    return query.order("id", { ascending: true }).range(from, to);
  });
  const overdueTasks = await pages<Task>((from, to) => {
    let query = db.from("task").select("id,org_id,commitment_id,title,due")
      .neq("status", "done").not("due", "is", null).lt("due", now.toISOString());
    if (args.orgId) query = query.eq("org_id", args.orgId);
    return query.order("id", { ascending: true }).range(from, to);
  });

  const invoices: Invoice[] = [];
  for (const status of ["sent", "overdue"] as const) {
    invoices.push(...await pages<Invoice>((from, to) => {
      let query = db.from("invoice").select("id,org_id,client_id,status,due_date").eq("status", status);
      if (args.orgId) query = query.eq("org_id", args.orgId);
      return query.order("id", { ascending: true }).range(from, to);
    }));
  }
  const recentTime = await pages<TimeEntry>((from, to) => {
    let query = db.from("time_entry").select("id,org_id,client_id,created_at")
      .gte("created_at", recentCutoff);
    if (args.orgId) query = query.eq("org_id", args.orgId);
    return query.order("id", { ascending: true }).range(from, to);
  });
  const openFlags = await pages<OpenFlag>((from, to) => {
    let query = db.from("payment_risk_flag")
      .select("id,org_id,client_id,signal,invoice_id,related_draft_id").eq("status", "open");
    if (args.orgId) query = query.eq("org_id", args.orgId);
    return query.order("id", { ascending: true }).range(from, to);
  });

  const [requirements, commitments] = await Promise.all([
    rowsByIds<Requirement>(db, "document_requirement", "id,name", missingDocuments.map((d) => d.requirement_id)),
    rowsByIds<Commitment>(db, "commitment", "id,org_id,client_id",
      overdueTasks.map((task) => task.commitment_id), args.orgId),
  ]);
  return { oldChangeOrders, missingDocuments, requirements, overdueTasks, commitments,
    invoices, recentTime, openFlags };
}

/**
 * Correlates operational warning signs with open invoices. Every base-table read is
 * paginated because PostgREST caps responses at 1,000 rows in this project.
 */
export async function scanPaymentRisks(
  db: SupabaseClient, args: ScanPaymentRisksArgs = {},
): Promise<ScanPaymentRisksResult> {
  const now = args.now ?? new Date();
  const input = await fetchInputs(db, args, now);
  const invoicesByClient = new Map<string, Invoice[]>();
  for (const invoice of input.invoices) {
    const key = clientKey(invoice.org_id, invoice.client_id);
    invoicesByClient.set(key, [...(invoicesByClient.get(key) ?? []), invoice]);
  }
  const requirementNames = new Map(input.requirements.map((row) => [row.id, row.name]));
  const commitments = new Map(input.commitments.map((row) => [row.id, row]));
  const candidates: Candidate[] = [];

  for (const draft of input.oldChangeOrders) {
    candidates.push({ orgId: draft.org_id, clientId: draft.client_id,
      signal: "unsent_change_order", invoiceId: null, relatedDraftId: draft.id,
      evidence: `A change order drafted on ${draft.created_at.slice(0, 10)} hasn't been sent yet — scope may be expanding unbilled.` });
  }
  for (const document of input.missingDocuments) {
    const name = requirementNames.get(document.requirement_id) ?? "Required document";
    for (const invoice of invoicesByClient.get(clientKey(document.org_id, document.client_id)) ?? []) {
      candidates.push({ orgId: document.org_id, clientId: document.client_id,
        signal: "missing_document", invoiceId: invoice.id, relatedDraftId: null,
        evidence: `${name} is still missing while invoice ${invoice.id} is ${invoice.status}.` });
    }
  }
  for (const task of input.overdueTasks) {
    const commitment = commitments.get(task.commitment_id);
    if (!commitment?.client_id || commitment.org_id !== task.org_id) continue;
    for (const invoice of invoicesByClient.get(clientKey(task.org_id, commitment.client_id)) ?? []) {
      candidates.push({ orgId: task.org_id, clientId: commitment.client_id,
        signal: "delivery_overdue", invoiceId: invoice.id, relatedDraftId: null,
        evidence: `${task.title} is ${overduePhrase(task.due, now)} while invoice ${invoice.id} is ${invoice.status}.` });
    }
  }

  let flagged = 0, alreadyOpen = 0;
  const open = new Set(input.openFlags.map(sourceKey));
  async function insertFlag(candidate: Candidate): Promise<string | null> {
    const key = sourceKey(candidate);
    if (open.has(key)) { alreadyOpen++; return null; }
    const { data, error } = await db.from("payment_risk_flag").insert({
      org_id: candidate.orgId, client_id: candidate.clientId, invoice_id: candidate.invoiceId,
      signal: candidate.signal, evidence: candidate.evidence,
      related_draft_id: candidate.relatedDraftId, status: "open",
    }).select("id").single();
    if (error && error.code !== "23505") throw error;
    if (error) { open.add(key); alreadyOpen++; return null; }
    open.add(key); flagged++;
    return data.id as string;
  }

  for (const candidate of candidates) {
    const flagId = await insertFlag(candidate);
    if (flagId) await logAudit({ orgId: candidate.orgId, actor: "agent", action: "draft",
      target: `payment_risk_flag:${flagId}:${candidate.signal}` });
  }

  const today = dateOnly(now);
  const quietThrough = dateOnly(new Date(now.getTime() + 3 * DAY_MS));
  const activeClients = new Set(input.recentTime.map((row) => clientKey(row.org_id, row.client_id)));
  const quietInvoices = input.invoices.filter((invoice) => invoice.status === "sent"
    && invoice.due_date && invoice.due_date >= today && invoice.due_date <= quietThrough
    && !activeClients.has(clientKey(invoice.org_id, invoice.client_id)));
  const clients = await rowsByIds<Client>(db, "client_contact", "id,name",
    quietInvoices.map((invoice) => invoice.client_id));
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const contractCache = new Map<string, Awaited<ReturnType<typeof contractFor>>>();

  for (const invoice of quietInvoices) {
    const candidate: Candidate = { orgId: invoice.org_id, clientId: invoice.client_id,
      signal: "invoice_due_quiet", invoiceId: invoice.id, relatedDraftId: null,
      evidence: `Invoice ${invoice.id} is due ${invoice.due_date}, and no time has been logged for this client in the last 14 days.` };
    const key = sourceKey(candidate);
    if (open.has(key)) { alreadyOpen++; continue; }

    if (!contractCache.has(invoice.org_id)) {
      contractCache.set(invoice.org_id, await contractFor(db, invoice.org_id));
    }
    const decision = canExecute("draft_payment_risk_checkin", false,
      contractCache.get(invoice.org_id)!, { sources: ["invoice"], now });
    if (!decision.ok) {
      candidate.evidence += ` A check-in draft was denied by blueprint policy (${decision.reason}).`;
    }

    const flagId = await insertFlag(candidate);
    if (!flagId) continue;
    if (decision.ok) {
      const { data: draft, error: draftError } = await db.from("client_message_draft").insert({
        org_id: invoice.org_id, client_id: invoice.client_id,
        kind: "payment_risk_checkin", source_id: invoice.id,
        subject: "Quick check-in before your invoice is due",
        body: `Hi ${clientNames.get(invoice.client_id) ?? "there"}, just checking in ahead of your invoice due ${invoice.due_date} — let us know if anything's needed on our end to keep things on track.`,
      }).select("id").single();
      if (draftError) throw draftError;
      const { error: updateError } = await db.from("payment_risk_flag")
        .update({ related_draft_id: draft.id as string }).eq("id", flagId).eq("org_id", invoice.org_id);
      if (updateError) throw updateError;
    }
    await logAudit({ orgId: invoice.org_id, actor: "agent", action: "draft",
      target: `payment_risk_flag:${flagId}:invoice_due_quiet` });
  }

  return { flagged, alreadyOpen };
}

export interface ResolvePaymentRiskArgs {
  orgId: string;
  flagId: string;
  next: "resolved" | "dismissed";
}

export async function resolvePaymentRiskFlag(
  db: SupabaseClient, args: ResolvePaymentRiskArgs,
): Promise<void> {
  const { data: flag, error } = await db.from("payment_risk_flag")
    .select("id,org_id").eq("id", args.flagId).maybeSingle();
  if (error) throw error;
  if (!flag || flag.org_id !== args.orgId) throw new Error("payment risk flag not found");

  const { error: updateError } = await db.from("payment_risk_flag")
    .update({ status: args.next }).eq("id", flag.id).eq("org_id", args.orgId);
  if (updateError) throw updateError;
  await logAudit({ orgId: args.orgId, actor: "human", action: "update",
    target: `payment_risk_flag:${flag.id}:${args.next}` });
}
