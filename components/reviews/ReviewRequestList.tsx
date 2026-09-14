"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pushReviewRequestDraft } from "@/app/actions/reviews";
import { Card, CardTitle, EmptyState, buttonStyle, proseStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export interface ReviewRequestListProps {
  drafts: { id: string; client_id: string; subject: string | null; body: string }[];
  clientNames: Record<string, string>;
}

export function ReviewRequestList({ drafts, clientNames }: ReviewRequestListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't update this review request right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}
      {drafts.length === 0 ? (
        <EmptyState title="Nothing pending"
          body="A draft appears here the next time a task is delivered or an invoice is marked paid." />
      ) : drafts.map((draft) => (
        <Card key={draft.id}>
          <CardTitle>{clientNames[draft.client_id] ?? "Client"}</CardTitle>
          <p style={{ ...proseStyle, color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {draft.subject}
          </p>
          <p style={{ ...proseStyle, whiteSpace: "pre-wrap", marginTop: "var(--space-2)" }}>
            {draft.body}
          </p>
          <button type="button" disabled={isPending}
            onClick={() => run(draft.id, async () => {
              const result = await pushReviewRequestDraft(draft.id);
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
