"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTaskStatus } from "@/app/actions/tasks";
import { Badge, SectionHeading, StatusPill, buttonStyle } from "@/components/ui/primitives";
import type { BoardTask } from "@/lib/db/queries";
import type { TaskStatus } from "@/lib/tasks/transitions";
import { presentError } from "@/lib/errors/presentation";

const DAY_MS = 86_400_000;

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: "open", label: "Open", hint: "Approved promises nobody has picked up yet." },
  { status: "in_progress", label: "In progress", hint: "Work somebody has started." },
  { status: "done", label: "Delivered", hint: "Promises kept. They stay here as the record." },
];

/**
 * Mirrors canTransition() in lib/tasks/transitions.ts — a button the server would refuse
 * is a bug, so these two lists move together.
 *
 * "Mark delivered" leads on both live columns: closing the loop is the action the product
 * exists for, and most promises in a small business go straight from open to done without
 * anyone ever marking them started.
 */
const MOVES: Record<TaskStatus, { next: TaskStatus; label: string; lead?: boolean }[]> = {
  open: [
    { next: "done", label: "Mark delivered", lead: true },
    { next: "in_progress", label: "Start" },
  ],
  in_progress: [
    { next: "done", label: "Mark delivered", lead: true },
    { next: "open", label: "Back to open" },
  ],
  done: [{ next: "open", label: "Reopen" }],
};

type Urgency = "late" | "today" | "clear" | "undated" | "delivered";

/** Same timestamp comparison the overdue sweep uses, so the board and the reminders agree. */
function urgencyOf(t: BoardTask, now: number): Urgency {
  if (t.status === "done") return "delivered";
  if (!t.due) return "undated";
  const due = Date.parse(t.due);
  if (due < now) return "late";
  return due < endOfToday(now) ? "today" : "clear";
}

function endOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function isoDay(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "no date";
}

function lateLabel(due: string, now: number): string {
  const days = Math.floor((now - Date.parse(due)) / DAY_MS);
  return days < 1 ? "late" : `${days}d late`;
}

/** The left rule is the fastest urgency read down a column, and costs no vertical space. */
const RULE: Record<Urgency, string> = {
  late: "var(--danger)",
  today: "var(--warn)",
  undated: "var(--warn)",
  clear: "transparent",
  delivered: "transparent",
};

function sortForColumn(status: TaskStatus, tasks: BoardTask[]): BoardTask[] {
  if (status === "done") {
    // Most recently delivered first: this column is a record, read newest-down.
    return [...tasks].sort((a, b) =>
      Date.parse(b.completed_at ?? "0") - Date.parse(a.completed_at ?? "0"));
  }
  // Soonest first, so whatever is late floats to the top and undated sinks.
  return [...tasks].sort((a, b) =>
    (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity));
}

export function TaskBoard({ items, nowIso }: { items: BoardTask[]; nowIso: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Passed from the server rather than read here: a client component computing the clock
  // during render disagrees with the server's markup across a day boundary, and React
  // reports a hydration mismatch.
  const now = Date.parse(nowIso);

  function move(taskId: string, next: TaskStatus) {
    setErrors((e) => ({ ...e, [taskId]: "" }));
    setMovingId(taskId);
    startTransition(async () => {
      try {
        await setTaskStatus(taskId, next);
        router.refresh();
      } catch (e) {
        setErrors((prev) => ({
          ...prev,
          [taskId]: presentError(e, { fallback: "That change did not stick. Try again." }),
        }));
      } finally {
        setMovingId(null);
      }
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(272px, 1fr))",
      gap: "var(--space-4)", alignItems: "start" }}>
      {COLUMNS.map((col) => {
        const tasks = sortForColumn(col.status, items.filter((t) => t.status === col.status));
        const archive = col.status === "done";

        return (
          <section key={col.status} aria-label={col.label}>
            <SectionHeading note={String(tasks.length)}>{col.label}</SectionHeading>

            {tasks.length === 0 ? (
              <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
                border: "1px dashed var(--border)", borderRadius: "var(--radius)",
                padding: "var(--space-4)", margin: 0, lineHeight: 1.5 }}>
                {col.hint}
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0,
                display: "grid", gap: "var(--space-2)" }}>
                {tasks.map((t) => {
                  const urgency = urgencyOf(t, now);
                  const pending = isPending && movingId === t.id;
                  const error = errors[t.id];

                  return (
                    <li key={t.id} aria-busy={pending} style={{
                      position: "relative", overflow: "hidden",
                      background: "var(--surface)", borderRadius: "var(--radius)",
                      border: "1px solid var(--border)",
                      borderLeft: `2px solid ${RULE[urgency]}`,
                      padding: "var(--space-3)",
                      // Delivered work is reference, not the job: present but receded.
                      opacity: archive ? 0.72 : 1,
                      transition: "opacity var(--motion)",
                    }}>
                      {/* Absolutely positioned so appearing costs no layout shift. */}
                      {pending && (
                        <span aria-hidden style={{ position: "absolute", insetInlineStart: 0,
                          insetInlineEnd: 0, top: 0, height: 2, background: "var(--accent)",
                          animation: "cf-pulse 1.4s ease-in-out infinite" }} />
                      )}

                      <div title={t.title} style={{ fontSize: "var(--text-base)", lineHeight: 1.4,
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        overflow: "hidden" }}>
                        {t.title}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                        marginTop: "var(--space-2)", flexWrap: "wrap" }}>
                        {archive ? (
                          <StatusPill tone="ok" label={`delivered ${isoDay(t.completed_at)}`} />
                        ) : (
                          <>
                            <span className="mono" style={{ fontSize: "var(--text-xs)",
                              color: urgency === "late" ? "var(--danger-text)" : "var(--muted)" }}>
                              {isoDay(t.due)}
                            </span>
                            {urgency === "late" && (
                              <Badge tone="danger">{lateLabel(t.due!, now)}</Badge>
                            )}
                            {urgency === "today" && <Badge tone="warn">due today</Badge>}
                            {urgency === "undated" && <Badge tone="warn">no date</Badge>}
                            {!t.owner && <Badge tone="warn">no owner</Badge>}
                          </>
                        )}
                      </div>

                      <div style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
                        marginTop: "var(--space-1)", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.client_name}{t.owner ? ` · ${t.owner}` : ""}
                      </div>

                      <div style={{ display: "flex", gap: "var(--space-2)",
                        marginTop: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                        {MOVES[t.status].map((m) => (
                          <button key={m.next} disabled={pending} aria-busy={pending && m.lead}
                            onClick={() => move(t.id, m.next)}
                            style={{
                              ...buttonStyle(m.lead ? "secondary" : "ghost", pending),
                              height: 26, padding: "0 9px", fontSize: "var(--text-sm)",
                              // Reserved width on the lead button: its label swaps while the
                              // move is in flight and the row must not jump.
                              ...(m.lead ? { minWidth: 112 } : null),
                            }}>
                            {pending && m.lead ? "Saving…" : m.label}
                          </button>
                        ))}
                        <Link href={`/queue/${t.commitment_id}`}
                          style={{ fontSize: "var(--text-sm)", color: "var(--faint)",
                            marginInlineStart: "auto" }}>
                          Source
                        </Link>
                      </div>

                      {error && (
                        <p role="alert" style={{ color: "var(--danger-text)",
                          fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
                          {error}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
