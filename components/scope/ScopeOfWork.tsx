"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setScopeOfWork } from "@/app/actions/scope";
import { Card, CardTitle, EmptyState, buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export interface ScopeOfWorkProps {
  clients: { id: string; name: string }[];
  scopes: { client_id: string; summary: string }[];
  canEdit: boolean;
  maxSummaryChars: number;
}

export function ScopeOfWork({ clients, scopes, canEdit, maxSummaryChars }: ScopeOfWorkProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't update scope of work right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <p style={{ color: "var(--muted)" }}>
        Write down what you agreed to do for each client. ConductFlow compares new
        promises against this, so it can nudge you if a client starts asking for
        something outside what was originally agreed.
      </p>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}
      {!canEdit && <p style={{ color: "var(--muted)" }}>Only an owner can edit this.</p>}
      {clients.length === 0 && <EmptyState title="No clients yet" body="Add a client when adding a transcript, then describe the agreed scope here." />}
      {clients.map((client) => {
        const summary = scopes.find((scope) => scope.client_id === client.id)?.summary ?? "";
        return (
          <Card key={client.id}>
            <CardTitle>{client.name}</CardTitle>
            <form onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(client.id, async () => {
                await setScopeOfWork(data); setNote(`Scope saved for ${client.name}.`);
              });
            }}>
              <input type="hidden" name="clientId" value={client.id} />
              <label style={labelStyle}>Agreed scope of work
                <textarea key={summary} name="summary" defaultValue={summary} rows={8} required
                  maxLength={maxSummaryChars} readOnly={!canEdit} disabled={isPending}
                  placeholder="Describe the deliverables, limits, and work included in this engagement."
                  style={{ ...fieldStyle, resize: "vertical" }} />
              </label>
              {canEdit && <button disabled={isPending} aria-busy={isPending && busyKey === client.id}
                style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === client.id ? "Saving…" : "Save scope"}
              </button>}
            </form>
          </Card>
        );
      })}
    </div>
  );
}
