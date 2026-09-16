"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import { createRetainer, logUsage, pushRetainerDraft } from "@/app/actions/retainers";
import type { Retainer } from "@/lib/retainers/ledger";
import { presentError } from "@/lib/errors/presentation";
import {
  Card, CardTitle, Badge, EmptyState, buttonStyle, fieldStyle, labelStyle, proseStyle,
} from "@/components/ui/primitives";

export interface RetainerListProps {
  unavailable?: Partial<Record<"clients" | "retainers" | "drafts", boolean>>;
  clients: { id: string; name: string }[];
  retainers: Retainer[];
  drafts: { id: string; source_id: string; subject: string | null; body: string }[];
}

export function RetainerList({ clients, retainers, drafts, unavailable = {} }: RetainerListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't update this retainer right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}
      {unavailable.clients ? <Unavailable section="Clients are" /> : clients.length === 0 ? (
        <EmptyState title="No clients yet" body="Add a client when adding a transcript, then create their package here." />
      ) : (
        <Card>
          <CardTitle>Create a package</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            A block of hours, sessions, or credits a client has paid for up front. ConductFlow
            tracks the balance and offers to draft a renewal when it runs low.
          </p>
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            run("create", async () => {
              await createRetainer(data); form.reset(); setNote("Package created.");
            });
          }}>
            <label style={labelStyle}>Client
              <select name="clientId" required disabled={isPending} style={fieldStyle} defaultValue="">
                <option value="" disabled>Choose a client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>What to call this package
              <input name="label" required disabled={isPending} style={fieldStyle}
                placeholder="e.g. 10-hour coaching package" />
            </label>
            <label style={labelStyle}>What are you counting?
              <select name="unit" defaultValue="hours" disabled={isPending} style={fieldStyle}>
                <option value="hours">Hours</option><option value="sessions">Sessions</option>
                <option value="credits">Credits</option>
              </select>
            </label>
            <label style={labelStyle}>How many did they buy?
              <input name="totalUnits" type="number" min="0.01" step="any" required
                disabled={isPending} style={fieldStyle} placeholder="e.g. 10" />
            </label>
            <label style={labelStyle}>Warn me when fewer than this many are left
              <input name="lowBalanceThreshold" type="number" min="0" step="any" defaultValue="2"
                required disabled={isPending} style={fieldStyle} />
              <span style={{ display: "block", color: "var(--faint)", fontSize: "var(--text-sm)",
                marginTop: "var(--space-1)" }}>
                ConductFlow drafts a renewal offer once the balance drops below this.
              </span>
            </label>
            <button disabled={isPending} aria-busy={isPending && busyKey === "create"}
              style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-4)" }}>
              {isPending && busyKey === "create" ? "Creating…" : "Create package"}
            </button>
          </form>
        </Card>
      )}
      {unavailable.retainers ? <Unavailable section="Retainers are" /> : retainers.length === 0 && <EmptyState title="No retainers yet" body="Create a package above to track its balance and renewal offers." />}
      {unavailable.drafts && <Unavailable section="Renewal drafts are" />}
      {retainers.map((retainer) => (
        <Card key={retainer.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <CardTitle>{retainer.label}</CardTitle>
            <Badge tone={retainer.status === "active" ? "ok" : retainer.status === "exhausted" ? "warn" : "neutral"}>
              {retainer.status}
            </Badge>
          </div>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {clients.find((client) => client.id === retainer.client_id)?.name ?? "Unknown client"}
          </p>
          <p className="tabular" style={{ marginTop: "var(--space-2)" }}>
            {Math.max(0, retainer.total_units - retainer.used_units)} {retainer.unit} remaining
            {" · "}{retainer.used_units} used of {retainer.total_units}
          </p>
          {retainer.status === "active" && (
            <form onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              run(retainer.id, async () => {
                const result = await logUsage(retainer.id, Number(data.get("units")), String(data.get("note") ?? ""));
                form.reset();
                setNote(`Usage logged.${result.renewalDrafted ? " Renewal draft ready below." : ""}`);
              });
            }}>
              <label style={labelStyle}>Usage ({retainer.unit})
                <input name="units" type="number" min="0.01" step="any" required disabled={isPending} style={fieldStyle} />
              </label>
              <label style={labelStyle}>Note (optional)
                <input name="note" disabled={isPending} style={fieldStyle} />
              </label>
              <button disabled={isPending} aria-busy={isPending && busyKey === retainer.id}
                style={{ ...buttonStyle("secondary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === retainer.id ? "Logging…" : "Log usage"}
              </button>
            </form>
          )}
          {drafts.filter((draft) => draft.source_id === retainer.id).map((draft) => (
            <div key={draft.id} style={{ marginTop: "var(--space-5)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
              <CardTitle>{draft.subject ?? "Renewal draft"}</CardTitle>
              <p style={{ ...proseStyle, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: "var(--space-3)" }}>{draft.body}</p>
              <button disabled={isPending} aria-busy={isPending && busyKey === draft.id}
                onClick={() => run(draft.id, async () => {
                  const result = await pushRetainerDraft(draft.id);
                  if (!result.pushed) throw new Error(result.reason);
                  setNote("Draft pushed to Gmail.");
                })} style={{ ...buttonStyle("secondary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === draft.id ? "Pushing…" : "Push to Gmail"}
              </button>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
