"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import {
  logTime, draftInvoice, markInvoiceSent, markInvoicePaid, runCollectionsSweep, pushInvoiceDraft,
} from "@/app/actions/billing";
import type { InvoiceStatus } from "@/lib/billing/transitions";
import {
  Card, CardTitle, Badge, EmptyState, buttonStyle, fieldStyle, labelStyle, proseStyle,
} from "@/components/ui/primitives";

export interface BillingPanelProps {
  unavailable?: Partial<Record<"clients" | "entries" | "invoices" | "drafts", boolean>>;
  clients: { id: string; name: string }[];
  entries: { id: string; client_id: string; minutes: number; note: string | null; created_at: string | null }[];
  invoices: { id: string; client_id: string; status: InvoiceStatus; total_cents: number; due_date: string | null }[];
  drafts: { id: string; client_id: string; kind: string; subject: string | null; body: string }[];
}

export function BillingPanel({ clients, entries, invoices, drafts, unavailable = {} }: BillingPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id ?? "");
  const clientId = clients.some((client) => client.id === selectedClientId) ? selectedClientId : clients[0]?.id ?? "";
  const unbilled = entries.filter((entry) => entry.client_id === clientId);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}
      {unavailable.clients ? <Unavailable section="Clients are" /> : clients.length === 0 ? (
        <EmptyState title="No clients yet" body="Add a client when adding a transcript, then log their time here." />
      ) : (
        <>
          <Card>
            <CardTitle>Log time</CardTitle>
            <label style={labelStyle}>Client
              <select value={clientId} onChange={(event) => setSelectedClientId(event.target.value)}
                disabled={isPending} style={fieldStyle}>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <form key={clientId} onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              run("time", async () => {
                await logTime(clientId, Number(data.get("minutes")), String(data.get("note") ?? ""));
                form.reset(); setNote("Time logged.");
              });
            }}>
              <label style={labelStyle}>Minutes
                <input name="minutes" type="number" min="1" max="2147483647" step="1" required disabled={isPending} style={fieldStyle} />
              </label>
              <label style={labelStyle}>Note (optional)
                <input name="note" disabled={isPending} style={fieldStyle} />
              </label>
              <button disabled={isPending} aria-busy={isPending && busyKey === "time"}
                style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === "time" ? "Logging…" : "Log time"}
              </button>
            </form>
          </Card>
          {unavailable.entries ? <Unavailable section="Un-invoiced time is" /> : <Card>
            <CardTitle>Un-invoiced time · {clients.find((client) => client.id === clientId)?.name}</CardTitle>
            {unbilled.length === 0 ? (
              <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>No un-invoiced time for this client.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
                {unbilled.map((entry) => (
                  <li key={entry.id} style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
                    <span className="tabular">{entry.minutes} minutes</span>
                    {entry.created_at && <span style={{ color: "var(--faint)" }}> · {entry.created_at.slice(0, 10)} (UTC)</span>}
                    {entry.note && <p style={{ color: "var(--muted)", overflowWrap: "anywhere", marginTop: "var(--space-2)" }}>{entry.note}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p style={{ color: "var(--faint)", marginTop: "var(--space-3)" }}>Uses the configured hourly rate for this client or organization.</p>
            <button disabled={isPending || unbilled.length === 0} aria-busy={isPending && busyKey === "invoice"}
              onClick={() => run("invoice", async () => {
                const result = await draftInvoice(clientId);
                setNote(`Invoice drafted from ${result.entriesInvoiced} time entries. Email draft ready below.`);
              })} style={{ ...buttonStyle("secondary", isPending || unbilled.length === 0), marginTop: "var(--space-4)" }}>
              {isPending && busyKey === "invoice" ? "Drafting…" : "Draft invoice"}
            </button>
          </Card>}
        </>
      )}
      <div>
        <button disabled={isPending} aria-busy={isPending && busyKey === "sweep"}
          onClick={() => run("sweep", async () => {
            const result = await runCollectionsSweep();
            setNote(`${result.drafted} collections drafts created · ${result.skipped} skipped.`);
          })} style={buttonStyle("secondary", isPending)}>
          {isPending && busyKey === "sweep" ? "Checking…" : "Run collections sweep"}
        </button>
      </div>
      {unavailable.invoices ? <Unavailable section="Invoices are" /> : invoices.length === 0 && <EmptyState title="No invoices yet" body="Log time for a client, then draft an invoice from their un-invoiced entries." />}
      {invoices.map((invoice) => (
        <Card key={invoice.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <CardTitle>{clients.find((client) => client.id === invoice.client_id)?.name ?? "Unknown client"}</CardTitle>
            <Badge tone={invoice.status === "paid" ? "ok" : invoice.status === "overdue" ? "warn" : "neutral"}>{invoice.status}</Badge>
          </div>
          <p className="mono" style={{ color: "var(--faint)", overflowWrap: "anywhere", marginTop: "var(--space-2)" }}>Invoice {invoice.id.slice(0, 8).toUpperCase()}</p>
          <p className="tabular" style={{ marginTop: "var(--space-3)" }}>
            ${(invoice.total_cents / 100).toFixed(2)} · {invoice.due_date ? `Due ${invoice.due_date}` : "No due date"}
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
            {invoice.status === "draft" && (
              <button disabled={isPending} aria-busy={isPending && busyKey === invoice.id}
                onClick={() => run(invoice.id, async () => {
                  await markInvoiceSent(invoice.id); setNote("Invoice marked sent.");
                })} style={buttonStyle("secondary", isPending)}>
                {isPending && busyKey === invoice.id ? "Saving…" : "Mark sent"}
              </button>
            )}
            {(invoice.status === "sent" || invoice.status === "overdue") && (
              <button disabled={isPending} aria-busy={isPending && busyKey === invoice.id}
                onClick={() => run(invoice.id, async () => {
                  await markInvoicePaid(invoice.id); setNote("Invoice marked paid.");
                })} style={buttonStyle("secondary", isPending)}>
                {isPending && busyKey === invoice.id ? "Saving…" : "Mark paid"}
              </button>
            )}
          </div>
        </Card>
      ))}
      {unavailable.drafts && <Unavailable section="Billing drafts are" />}
      {drafts.map((draft) => (
        <Card key={draft.id}>
          <CardTitle>{draft.subject ?? "Billing draft"}</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {clients.find((client) => client.id === draft.client_id)?.name ?? "Unknown client"} · {draft.kind.replaceAll("_", " ")} · Pending draft
          </p>
          <p style={{ ...proseStyle, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: "var(--space-3)" }}>{draft.body}</p>
          <button disabled={isPending} aria-busy={isPending && busyKey === draft.id}
            onClick={() => run(draft.id, async () => {
              const result = await pushInvoiceDraft(draft.id);
              if (!result.pushed) throw new Error(result.reason);
              setNote("Draft pushed to Gmail.");
            })} style={{ ...buttonStyle("secondary", isPending), marginTop: "var(--space-4)" }}>
            {isPending && busyKey === draft.id ? "Pushing…" : "Push to Gmail"}
          </button>
        </Card>
      ))}
    </div>
  );
}
