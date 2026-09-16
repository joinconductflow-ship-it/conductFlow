"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import { resolveRisk, scanForPaymentRisk } from "@/app/actions/payments";
import { presentError } from "@/lib/errors/presentation";
import { Card, CardTitle, EmptyState, Badge, buttonStyle, proseStyle } from "@/components/ui/primitives";

type Signal = "unsent_change_order" | "missing_document" | "delivery_overdue" | "invoice_due_quiet";
const SIGNAL_LABELS: Record<Signal, string> = {
  unsent_change_order: "Unsent change order",
  missing_document: "Missing document",
  delivery_overdue: "Delivery overdue",
  invoice_due_quiet: "Invoice due, client's gone quiet",
};

export interface PaymentRiskPanelProps {
  unavailable?: boolean;
  flags: { id: string; client_id: string; invoice_id: string | null; signal: Signal;
    evidence: string; related_draft_id: string | null; created_at: string }[];
  clientNames: Record<string, string>;
  relatedDrafts: Record<string, { subject: string | null; body: string }>;
}

export function PaymentRiskPanel({ flags, clientNames, relatedDrafts, unavailable }: PaymentRiskPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(key: string, action: () => Promise<unknown>) {
    setError(null); setBusyKey(key);
    startTransition(async () => {
      try { await action(); router.refresh(); }
      catch (caught) { setError(presentError(caught, { fallback: "Couldn't update payment risk right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <p style={{ color: "var(--muted)" }}>
        Warns you before an invoice becomes a problem, like work that was never
        formally agreed to, or a client who’s gone quiet right when a bill is due.
      </p>
      <div>
        <button type="button" disabled={isPending} onClick={() => run("scan", scanForPaymentRisk)}
          style={buttonStyle("primary", isPending)}>
          {isPending && busyKey === "scan" ? "Scanning…" : "Check now"}
        </button>
      </div>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {unavailable ? <Unavailable section="Payment risk flags are" /> : flags.length === 0 ? <EmptyState title="Nothing to worry about right now."
        body="Check any time, ConductFlow looks at your current invoices and work in progress for anything that could become a payment problem." /> : flags.map((flag) => {
        const draft = flag.related_draft_id ? relatedDrafts[flag.related_draft_id] : undefined;
        return (
          <Card key={flag.id} tone={flag.signal === "invoice_due_quiet" ? "warn" : "neutral"}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)",
              alignItems: "baseline", flexWrap: "wrap" }}>
              <CardTitle>{clientNames[flag.client_id] ?? "Client"}</CardTitle>
              <Badge tone="warn">{SIGNAL_LABELS[flag.signal]}</Badge>
            </div>
            <p style={{ ...proseStyle, marginTop: "var(--space-3)" }}>{flag.evidence}</p>
            {draft && <div style={{ borderLeft: "3px solid var(--accent-line)",
              paddingLeft: "var(--space-3)", marginTop: "var(--space-4)" }}>
              {draft.subject && <div style={{ fontWeight: 600 }}>{draft.subject}</div>}
              <p style={{ ...proseStyle, whiteSpace: "pre-wrap", marginTop: "var(--space-2)" }}>
                {draft.body}
              </p>
              <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
                Push this from the Billing or Documents page.
              </p>
            </div>}
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
              <button type="button" disabled={isPending}
                onClick={() => run(`${flag.id}:resolved`, () => resolveRisk(flag.id, "resolved"))}
                style={buttonStyle("secondary", isPending)}>
                {isPending && busyKey === `${flag.id}:resolved` ? "Updating…" : "Resolve"}
              </button>
              <button type="button" disabled={isPending}
                onClick={() => run(`${flag.id}:dismissed`, () => resolveRisk(flag.id, "dismissed"))}
                style={buttonStyle("secondary", isPending)}>
                {isPending && busyKey === `${flag.id}:dismissed` ? "Updating…" : "Dismiss"}
              </button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
