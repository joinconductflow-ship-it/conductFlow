"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeRecurring } from "@/app/actions/proposals";
import type { RecurringPattern } from "@/lib/ops/recurring";
import { CardTitle, Badge, buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export function RecurringSuggestions({ patterns }: { patterns: RecurringPattern[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  if (patterns.length === 0) return null;

  return (
    // Dashed rather than solid: everything else on this screen is a promise somebody
    // actually made. These are guesses, and the border says so before the text does.
    <section style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--radius)",
      padding: "var(--space-4)", marginTop: "var(--space-6)" }}>
      <CardTitle tone="accent" dot>Likely due</CardTitle>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "68ch" }}>
        Promises you have made on a regular cadence, and the next one looks due. Nothing is
        created until you add it, and adding puts it in the queue for review like any other
        promise.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {patterns.map((p) => {
          const busy = isPending && adding === p.key;
          const done = added.includes(p.key);
          return (
            <li key={p.key} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: "var(--space-4)",
              padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block" }}>{p.representativeText}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                  marginTop: "var(--space-1)", flexWrap: "wrap" }}>
                  <span className="mono" style={{ color: "var(--faint)",
                    fontSize: "var(--text-xs)" }}>
                    {p.clientName} · {p.cadence} · seen {p.occurrences}× · due{" "}
                    {p.nextExpectedIso.slice(0, 10)}
                  </span>
                  {/* A guess should show how good a guess it is. */}
                  <Badge tone={p.confidence === "high" ? "neutral" : "warn"}>
                    {p.confidence} confidence
                  </Badge>
                </span>
              </span>

              {done ? (
                <span style={{ color: "var(--ok)", fontSize: "var(--text-sm)",
                  flexShrink: 0, minWidth: 118, textAlign: "center" }}>
                  Added to queue
                </span>
              ) : (
                <button disabled={isPending} aria-busy={busy}
                  onClick={() => {
                    setError(null);
                    setAdding(p.key);
                    startTransition(async () => {
                      try {
                        await proposeRecurring(p.key);
                        setAdded((a) => [...a, p.key]);
                        router.refresh();
                      } catch (e) {
                        setError(presentError(e, { fallback: "Couldn't add that promise right now. Try again." }));
                      } finally { setAdding(null); }
                    });
                  }}
                  // Matches the width of the "Added to queue" confirmation it is replaced
                  // by, so the row holds still.
                  style={{ ...buttonStyle("secondary", isPending), minWidth: 118,
                    justifyContent: "center", flexShrink: 0 }}>
                  {busy ? "Adding…" : "Add to queue"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
