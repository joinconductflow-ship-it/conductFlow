"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import {
  addDocumentRequirement, markDocumentReceived, runDocumentSweep, pushDocumentDraft,
} from "@/app/actions/documents";
import {
  Card, CardTitle, Badge, EmptyState, buttonStyle, fieldStyle, labelStyle, proseStyle,
} from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export interface DocumentChecklistProps {
  unavailable?: Partial<Record<"clients" | "requirements" | "documents" | "drafts", boolean>>;
  clients: { id: string; name: string }[];
  requirements: { id: string; name: string; description: string | null }[];
  documents: { id: string; client_id: string; requirement_id: string; status: string }[];
  drafts: { id: string; client_id: string; subject: string | null; body: string }[];
}

export function DocumentChecklist({ clients, requirements, documents, drafts, unavailable = {} }: DocumentChecklistProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't update document tracking right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}
      <Card>
        <CardTitle>Ask every client for a document</CardTitle>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
          Add it once here and ConductFlow tracks who's sent it and who hasn't, for
          every client you have.
        </p>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          run("add", async () => {
            await addDocumentRequirement(data); form.reset(); setNote("Added to the checklist.");
          });
        }}>
          <label style={labelStyle}>What document?
            <input name="name" required disabled={isPending} style={fieldStyle}
              placeholder="e.g. Signed intake form" />
          </label>
          <label style={labelStyle}>Notes for yourself (optional)
            <textarea name="description" rows={3} disabled={isPending} style={fieldStyle} />
          </label>
          <button disabled={isPending} aria-busy={isPending && busyKey === "add"}
            style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-4)" }}>
            {isPending && busyKey === "add" ? "Adding…" : "Add to checklist"}
          </button>
        </form>
      </Card>
      <div>
        <button disabled={isPending} aria-busy={isPending && busyKey === "sweep"}
          onClick={() => run("sweep", async () => {
            const result = await runDocumentSweep();
            setNote(`${result.drafted} reminder drafts created · ${result.skipped} skipped.`);
          })} style={buttonStyle("secondary", isPending)}>
          {isPending && busyKey === "sweep" ? "Chasing…" : "Chase now"}
        </button>
      </div>
      {unavailable.requirements ? <Unavailable section="Document requirements are" /> : requirements.length === 0 && <EmptyState title="No requirements yet" body="Add a document above to start a checklist for your clients." />}
      {requirements.map((requirement) => (
        <Card key={requirement.id}>
          <CardTitle>{requirement.name}</CardTitle>
          {requirement.description && <p style={{ ...proseStyle, color: "var(--muted)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: "var(--space-2)" }}>{requirement.description}</p>}
          {unavailable.clients ? <Unavailable section="Clients are" /> : clients.length === 0 && <p style={{ color: "var(--faint)", marginTop: "var(--space-3)" }}>No clients yet.</p>}
          {unavailable.documents && <Unavailable section="Document statuses are" />}
          <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
            {clients.map((client) => {
              const document = documents.find((row) => row.client_id === client.id && row.requirement_id === requirement.id);
              return (
                <li key={client.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)", padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
                  <span>{client.name}</span>
                  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                    <Badge tone={document?.status === "received" ? "ok" : document?.status === "missing" ? "warn" : "neutral"}>
                      {unavailable.documents ? "unavailable"
                        : document?.status === "received" ? "received"
                        : document?.status === "missing" ? "waiting on it"
                        : "not needed for this client"}
                    </Badge>
                    {document?.status === "missing" && (
                      <button disabled={isPending} aria-busy={isPending && busyKey === document.id}
                        onClick={() => run(document.id, async () => {
                          await markDocumentReceived(document.id); setNote("Document marked received.");
                        })} style={buttonStyle("secondary", isPending)}>
                        {isPending && busyKey === document.id ? "Saving…" : "Mark received"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {unavailable.drafts && <Unavailable section="Document reminder drafts are" />}
      {drafts.map((draft) => (
        <Card key={draft.id}>
          <CardTitle>{draft.subject ?? "Document reminder"}</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {clients.find((client) => client.id === draft.client_id)?.name ?? "Unknown client"} · Pending draft
          </p>
          <p style={{ ...proseStyle, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: "var(--space-3)" }}>{draft.body}</p>
          <button disabled={isPending} aria-busy={isPending && busyKey === draft.id}
            onClick={() => run(draft.id, async () => {
              const result = await pushDocumentDraft(draft.id);
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
