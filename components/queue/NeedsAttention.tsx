"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryExtraction } from "@/app/actions/ingest";
import type { FailedTranscript } from "@/lib/db/queries";
import { Card, CardTitle, buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export function NeedsAttention({ items }: { items: FailedTranscript[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;

  return (
    <Card tone="danger" style={{ marginBottom: "var(--space-4)" }}>
      <CardTitle tone="danger" dot>Extraction failed</CardTitle>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "68ch" }}>
        Nothing was lost — the transcript is saved exactly as it arrived. Retrying runs
        extraction against it again.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {items.map((t) => {
          const busy = isPending && retrying === t.id;
          return (
            <li key={t.id} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: "var(--space-4)",
              padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 500 }}>{t.title}</span>
                <span className="mono" style={{ display: "block", color: "var(--faint)",
                  fontSize: "var(--text-xs)", marginTop: "var(--space-1)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {presentError(t.extraction_error, {
                    fallback: "Extraction failed. Retry to try again.",
                  })}
                </span>
              </span>
              <button
                disabled={isPending}
                aria-busy={busy}
                onClick={() => {
                  setError(null);
                  setRetrying(t.id);
                  startTransition(async () => {
                    try { await retryExtraction(t.id); router.refresh(); }
                    catch (e) { setError(presentError(e, {
                      fallback: "Couldn't retry extraction. Try again.",
                      authentication: "Please sign in again to retry extraction.",
                    })); }
                  });
                }}
                // Fixed width so the label can change without the row reflowing.
                style={{ ...buttonStyle("secondary", isPending), minWidth: 92,
                  justifyContent: "center", flexShrink: 0 }}>
                {busy ? "Retrying…" : "Retry"}
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="cf-empty-state" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>
          That retry did not go through.{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>{error}</span>
        </p>
      )}
    </Card>
  );
}
