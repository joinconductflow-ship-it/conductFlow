import type { SupabaseClient } from "@supabase/supabase-js";
import { logFailure } from "@/lib/observability/log";

const PAGE_SIZE = 1000;

/** Keep every failed query identifiable, including rejected requests and later pages. */
async function reportQuery<T>(name: string, query: () => PromiseLike<{ data: T; error: unknown }>) {
  try {
    const result = await query();
    if (result.error) throw result.error;
    return result;
  } catch (error) {
    logFailure(`/reports: ${name}`, error);
    throw error;
  }
}

interface TimeEntry {
  client_id: string;
  minutes: number;
  invoiced: boolean;
}

interface Invoice {
  client_id: string;
  total_cents: number;
}

interface Client {
  id: string;
  name: string | null;
}

interface BillingRate {
  client_id: string | null;
  unit: string;
  amount_cents: number;
}

export interface ClientUtilization {
  clientId: string;
  clientName: string;
  minutesLogged: number;
  minutesInvoiced: number;
  minutesUnbilled: number;
  revenueInvoicedCents: number;
  revenueUnbilledCents: number;
}

async function fetchTimeEntries(db: SupabaseClient, orgId: string): Promise<TimeEntry[]> {
  const entries: TimeEntry[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await reportQuery(`time_entry page at offset ${offset}`, () => db.from("time_entry").select("client_id,minutes,invoiced")
      .eq("org_id", orgId).order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1));
    entries.push(...((data ?? []) as TimeEntry[]));
    if ((data ?? []).length < PAGE_SIZE) return entries;
  }
}

async function fetchInvoices(db: SupabaseClient, orgId: string): Promise<Invoice[]> {
  const invoices: Invoice[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data } = await reportQuery(`invoice page at offset ${offset}`, () => db.from("invoice").select("client_id,total_cents")
      .eq("org_id", orgId).order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1));
    invoices.push(...((data ?? []) as Invoice[]));
    if ((data ?? []).length < PAGE_SIZE) return invoices;
  }
}

/** Read-only per-client time and billing rollup for an organization. */
export async function getUtilizationSummary(
  db: SupabaseClient, args: { orgId: string },
): Promise<ClientUtilization[]> {
  const [entries, invoices, clientsResult, ratesResult] = await Promise.all([
    fetchTimeEntries(db, args.orgId),
    fetchInvoices(db, args.orgId),
    reportQuery("client_contact", () => db.from("client_contact").select("id,name").eq("org_id", args.orgId)),
    reportQuery("billing_rate", () => db.from("billing_rate").select("client_id,unit,amount_cents").eq("org_id", args.orgId)),
  ]);

  const clients = new Map(((clientsResult.data ?? []) as Client[]).map((client) => [client.id, client.name]));
  const rates = (ratesResult.data ?? []) as BillingRate[];
  const defaultRate = rates.find((rate) => rate.client_id === null);
  const clientRates = new Map(rates
    .filter((rate) => rate.client_id !== null)
    .map((rate) => [rate.client_id!, rate]));
  const summaries = new Map<string, ClientUtilization>();

  for (const entry of entries) {
    let summary = summaries.get(entry.client_id);
    if (!summary) {
      summary = {
        clientId: entry.client_id,
        clientName: clients.get(entry.client_id) ?? "Unknown client",
        minutesLogged: 0,
        minutesInvoiced: 0,
        minutesUnbilled: 0,
        revenueInvoicedCents: 0,
        revenueUnbilledCents: 0,
      };
      summaries.set(entry.client_id, summary);
    }
    summary.minutesLogged += entry.minutes;
    if (entry.invoiced) summary.minutesInvoiced += entry.minutes;
    else summary.minutesUnbilled += entry.minutes;
  }

  for (const invoice of invoices) {
    const summary = summaries.get(invoice.client_id);
    if (summary) summary.revenueInvoicedCents += invoice.total_cents;
  }

  for (const summary of summaries.values()) {
    const rate = clientRates.get(summary.clientId) ?? defaultRate;
    if (rate?.unit === "hourly") {
      summary.revenueUnbilledCents = Math.floor(
        (summary.minutesUnbilled * rate.amount_cents + 30) / 60,
      );
    }
  }

  return [...summaries.values()].sort((a, b) => b.minutesLogged - a.minutesLogged);
}
