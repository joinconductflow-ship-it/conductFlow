import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

const PAGE_SIZE = 1000;
const REMIND_COOLOFF_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CENTS = BigInt(2147483647);

interface TimeEntry { id: string; minutes: number }
interface BillingRate { id: string; unit: string; amount_cents: number }
interface Invoice {
  id: string; org_id: string; client_id: string; status: string;
  total_cents: number; due_date: string; last_reminded_at: string | null;
}

function money(cents: number): string {
  const value = BigInt(cents);
  return `$${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`;
}

export async function draftInvoiceFromTimeEntries(
  db: SupabaseClient, args: { clientId: string; orgId: string; now?: Date },
): Promise<{ invoiceId: string; totalCents: number; entriesInvoiced: number; draftId: string }> {
  const now = args.now ?? new Date();
  const contract = await contractFor(db, args.orgId);
  const decision = canExecute("draft_invoice", false, contract,
    { sources: ["client_contact", "template"], now });
  if (!decision.ok) throw new Error(`invoice drafting denied: ${decision.reason}`);

  const { data: client, error: clientError } = await db.from("client_contact")
    .select("id,name").eq("id", args.clientId).eq("org_id", args.orgId).maybeSingle();
  if (clientError) throw clientError;
  if (!client) throw new Error("client not found in this organization");

  const { data: clientRate, error: clientRateError } = await db.from("billing_rate")
    .select("id,unit,amount_cents").eq("org_id", args.orgId).eq("client_id", args.clientId).maybeSingle();
  if (clientRateError) throw clientRateError;
  let rate = clientRate as BillingRate | null;
  if (!rate) {
    const { data, error } = await db.from("billing_rate")
      .select("id,unit,amount_cents").eq("org_id", args.orgId).is("client_id", null).maybeSingle();
    if (error) throw error;
    rate = data as BillingRate | null;
  }
  if (!rate) throw new Error("no billing rate configured for this client or organization");
  if (rate.unit !== "hourly") throw new Error("time-entry invoices require an hourly billing rate");
  if (!Number.isSafeInteger(rate.amount_cents) || rate.amount_cents <= 0
    || BigInt(rate.amount_cents) > MAX_CENTS) throw new Error("billing rate must be positive integer cents");

  const entries: TimeEntry[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db.from("time_entry").select("id,minutes")
      .eq("org_id", args.orgId).eq("client_id", args.clientId).eq("invoiced", false)
      .order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    entries.push(...((data ?? []) as TimeEntry[]));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  if (!entries.length) throw new Error("no un-invoiced time entries for this client");
  let minutes = BigInt(0);
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.minutes) || entry.minutes <= 0) throw new Error("invalid time entry minutes");
    minutes += BigInt(entry.minutes);
  }
  // Round the complete rollup once; rounding each entry makes splitting time change the bill.
  const total = (minutes * BigInt(rate.amount_cents) + BigInt(30)) / BigInt(60);
  if (total > MAX_CENTS) throw new Error("invoice total exceeds the integer cents database limit");
  const totalCents = Number(total);
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 30);
  const invoiceId = randomUUID(), draftId = randomUUID();
  const dueDate = due.toISOString().slice(0, 10);
  // A client-facing label shorter than the full UUID; the UUID stays the real key everywhere else.
  const invoiceNumber = invoiceId.slice(0, 8).toUpperCase();

  // One transaction prevents a failed draft or a competing rollup from consuming time twice.
  const { error } = await db.rpc("create_time_invoice", {
    p_invoice: { id: invoiceId, org_id: args.orgId, client_id: args.clientId,
      total_cents: totalCents, total_minutes: String(minutes), due_date: dueDate, created_at: now.toISOString() },
    p_entry_ids: entries.map((entry) => entry.id),
    p_rate_id: rate.id, p_rate_cents: rate.amount_cents,
    p_message: { id: draftId, subject: `Invoice ${invoiceNumber}`,
      body: `Hi ${client.name ?? "there"},\n\nInvoice ${invoiceNumber} covers ${minutes} minutes at ${money(rate.amount_cents)} per hour.\nTotal due: ${money(totalCents)}\nDue date: ${dueDate} (net 30).\n\nPlease let me know if you have any questions.\n\nThanks!` },
  });
  if (error) throw error;

  await logAudit({ orgId: args.orgId, actor: "agent", action: "draft", target: `invoice:${invoiceId}:draft` });
  return { invoiceId, totalCents, entriesInvoiced: entries.length, draftId };
}

export interface SweepInvoicesOptions { orgId?: string; now?: Date }
export interface SweepInvoicesResult { drafted: number; skipped: number }

async function fetchOverdueInvoices(
  db: SupabaseClient, now: Date, orgId?: string,
): Promise<Invoice[]> {
  const invoices: Invoice[] = [];
  // Read every page before updates change membership in the sent query.
  for (const status of ["sent", "overdue"]) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = db.from("invoice")
        .select("id,org_id,client_id,status,total_cents,due_date,last_reminded_at")
        .eq("status", status).lt("due_date", now.toISOString().slice(0, 10));
      if (orgId) query = query.eq("org_id", orgId);
      const { data, error } = await query.order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      invoices.push(...((data ?? []) as Invoice[]));
      if ((data ?? []).length < PAGE_SIZE) break;
    }
  }
  return invoices;
}

export async function sweepOverdueInvoices(
  db: SupabaseClient, options: SweepInvoicesOptions = {},
): Promise<SweepInvoicesResult> {
  const now = options.now ?? new Date();
  const due = await fetchOverdueInvoices(db, now, options.orgId);
  let drafted = 0, skipped = 0;
  const contractCache = new Map<string, Awaited<ReturnType<typeof contractFor>>>();
  for (const invoice of due) {
    if (invoice.status === "sent") {
      const { data, error } = await db.from("invoice").update({ status: "overdue" })
        .eq("id", invoice.id).eq("org_id", invoice.org_id).eq("status", "sent")
        .eq("due_date", invoice.due_date).select("id");
      if (error) throw error;
      if (!data?.length) { skipped++; continue; }
      await logAudit({ orgId: invoice.org_id, actor: "agent", action: "update",
        target: `invoice:${invoice.id}:overdue` });
    }
    if (invoice.last_reminded_at
      && Date.parse(invoice.last_reminded_at) >= now.getTime() - REMIND_COOLOFF_MS) continue;

    if (!contractCache.has(invoice.org_id)) {
      contractCache.set(invoice.org_id, await contractFor(db, invoice.org_id));
    }
    const decision = canExecute("draft_collections_reminder", false, contractCache.get(invoice.org_id)!,
      { sources: ["client_contact", "template"], now });
    if (!decision.ok) { skipped++; continue; }

    const { data: client, error: clientError } = await db.from("client_contact")
      .select("name").eq("id", invoice.client_id).eq("org_id", invoice.org_id).maybeSingle();
    if (clientError) throw clientError;
    if (!client) throw new Error("invoice client not found in this organization");
    const { data: created, error } = await db.rpc("draft_invoice_collection", {
      p_invoice_id: invoice.id, p_org_id: invoice.org_id, p_now: now.toISOString(),
      p_total_cents: invoice.total_cents, p_due_date: invoice.due_date,
      p_subject: `Payment reminder: invoice ${invoice.id.slice(0, 8).toUpperCase()}`,
      p_body: `Hi ${client.name ?? "there"},\n\nA quick reminder that invoice ${invoice.id.slice(0, 8).toUpperCase()} for ${money(invoice.total_cents)} was due on ${invoice.due_date}. If you've already paid, please let me know so I can update our records. Otherwise, could you share when we can expect payment?\n\nThanks!`,
    });
    if (error) throw error;
    if (!created) { skipped++; continue; }
    await logAudit({ orgId: invoice.org_id, actor: "agent", action: "draft",
      target: `invoice:${invoice.id}:collections_reminder` });
    drafted++;
  }
  return { drafted, skipped };
}
