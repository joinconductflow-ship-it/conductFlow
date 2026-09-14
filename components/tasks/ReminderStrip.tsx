"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissReminder, runSweep } from "@/app/actions/tasks";
import type { OpenReminder } from "@/lib/db/queries";
import { Card, CardTitle, Badge, buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

const VISIBLE_LIMIT = 5;

function daysLate(dueAt: string, now: number) {
  const ms = now - new Date(dueAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  return days <= 0 ? "due today" : `${days}d late`;
}

// nowIso comes from the server for the same reason it does on the board: a client
// component reading the clock during render mismatches the server's markup.
export function ReminderStrip({ items, nowIso }: { items: OpenReminder[]; nowIso: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // A backlog of forty nudges pushes the board it sits above off the screen entirely.
  // The oldest few are the ones that matter; the rest stay one click away.
  const visible = expanded ? items : items.slice(0, VISIBLE_LIMIT);
  const hidden = items.length - visible.length;

  function act(id: string | null, fn: () => Promise<unknown>, describe?: (r: unknown) => string) {
    setError(null); setNote(null); setClearing(id);
    startTransition(async () => {
      try {
        const result = await fn();
        if (describe) setNote(describe(result));
        router.refresh();
      } catch (e) { setError(presentError(e, { fallback: "Couldn't update reminders right now. Try again." })); }
      finally { setClearing(null); }
    });
  }

  const sweeping = isPending && clearing === null;
  const check = (
    <button disabled={isPending} aria-busy={sweeping}
      onClick={() => act(null, runSweep, (r) => {
        const { raised } = r as { raised: number };
        return raised === 0
          ? "Nothing new is overdue."
          : `${raised} overdue promise${raised === 1 ? "" : "s"} flagged.`;
      })}
      // Reserved width so the label can swap without moving the row beside it.
      style={{ ...buttonStyle("ghost", isPending), minWidth: 132, justifyContent: "center" }}>
      {sweeping ? "Checking…" : "Check for overdue"}
    </button>
  );

  // Nothing overdue is the good day, and a good day should not get a banner. One quiet
  // line, with the manual check still within reach.
  if (items.length === 0) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "var(--space-3)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        <span style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>
          {note ?? "Nothing overdue. The scheduled sweep runs daily."}
        </span>
        {check}
      </div>
    );
  }

  return (
    <Card tone="danger" style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "var(--space-3)", flexWrap: "wrap" }}>
        <CardTitle tone="danger" dot>
          {items.length} overdue promise{items.length === 1 ? "" : "s"}
        </CardTitle>
        {check}
      </div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "68ch" }}>
        These passed their date without being delivered. Dismissing clears the nudge; it does
        not close the task.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {visible.map((r) => {
          const busy = isPending && clearing === r.id;
          return (
            <li key={r.id} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", gap: "var(--space-4)",
              padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                  marginTop: "var(--space-1)" }}>
                  <span className="mono" style={{ color: "var(--faint)",
                    fontSize: "var(--text-xs)" }}>
                    {new Date(r.due_at).toISOString().slice(0, 10)}
                  </span>
                  <Badge tone="danger">{daysLate(r.due_at, Date.parse(nowIso))}</Badge>
                </span>
              </span>
              <button disabled={isPending} aria-busy={busy}
                onClick={() => act(r.id, () => dismissReminder(r.id))}
                style={{ ...buttonStyle("ghost", isPending), minWidth: 92,
                  justifyContent: "center", flexShrink: 0 }}>
                {busy ? "Clearing…" : "Dismiss"}
              </button>
            </li>
          );
        })}
      </ul>

      {(hidden > 0 || expanded) && items.length > VISIBLE_LIMIT && (
        <button onClick={() => setExpanded((v) => !v)}
          style={{ ...buttonStyle("ghost"), marginTop: "var(--space-3)" }}>
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}

      {note && <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>{note}</p>}
      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>
          {error}
        </p>
      )}
    </Card>
  );
}
