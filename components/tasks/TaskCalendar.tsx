"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/primitives";
import type { BoardTask } from "@/lib/db/queries";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

type Urgency = "late" | "today" | "clear" | "delivered";

function urgencyOf(t: BoardTask, now: number): Urgency {
  if (t.status === "done") return "delivered";
  if (!t.due) return "clear";
  return Date.parse(t.due) < now ? "late" : "clear";
}

const DOT: Record<Urgency, string> = {
  late: "var(--danger)",
  today: "var(--warn)",
  clear: "var(--accent)",
  delivered: "var(--ok)",
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Every visible cell for a month, including the lead/trail days from neighboring months
 * needed to fill a whole 7-column grid — a calendar with ragged edges reads as broken. */
function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

export function TaskCalendar({ items, nowIso }: { items: BoardTask[]; nowIso: string }) {
  const now = Date.parse(nowIso);
  const today = new Date(nowIso);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const byDay = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const t of items) {
      if (!t.due) continue;
      const key = dayKey(new Date(t.due));
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [items]);

  const undated = items.filter((t) => !t.due && t.status !== "done");
  const cells = useMemo(() => buildGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const todayKey = dayKey(today);
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            aria-label="Previous month"
            style={navButtonStyle}>‹</button>
          <span style={{ fontWeight: 600, fontSize: "var(--text-md)", minWidth: 148,
            textAlign: "center" }}>
            {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
          </span>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            aria-label="Next month"
            style={navButtonStyle}>›</button>
        </div>
        <button
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          style={{ ...navButtonStyle, width: "auto", padding: "0 10px",
            fontSize: "var(--text-sm)" }}>
          Today
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        border: "1px solid var(--border)", borderRadius: "var(--radius)",
        overflow: "hidden", background: "var(--border)", gap: 1 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ background: "var(--raised)", padding: "6px 8px",
            fontSize: "var(--text-xs)", color: "var(--faint)", textAlign: "center",
            fontWeight: 600, letterSpacing: "0.02em" }}>
            {w}
          </div>
        ))}
        <AnimatePresence mode="wait">
          <motion.div
            key={monthKey}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.18 }}
            style={{ display: "contents" }}
          >
            {cells.map((d) => {
              const key = dayKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const tasks = byDay.get(key) ?? [];
              const isToday = key === todayKey;
              return (
                <div key={key} style={{
                  background: "var(--surface)",
                  minHeight: 96,
                  padding: "var(--space-2)",
                  opacity: inMonth ? 1 : 0.35,
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <span className="mono" style={{
                    fontSize: "var(--text-xs)",
                    color: isToday ? "var(--accent-text)" : "var(--faint)",
                    fontWeight: isToday ? 700 : 400,
                    ...(isToday ? {
                      display: "inline-flex", width: 18, height: 18, alignItems: "center",
                      justifyContent: "center", borderRadius: 999, background: "var(--accent-quiet)",
                    } : {}),
                  }}>
                    {d.getDate()}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {tasks.slice(0, 3).map((t) => {
                      const urgency = urgencyOf(t, now);
                      return (
                        <Link key={t.id} href={`/queue/${t.commitment_id}`} className="cf-row"
                          title={t.title}
                          style={{
                            display: "flex", alignItems: "center", gap: 5,
                            fontSize: 11, lineHeight: 1.3, color: "var(--text)",
                            padding: "2px 5px", borderRadius: 4,
                            background: "var(--raised)",
                            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                          }}>
                          <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999,
                            background: DOT[urgency], flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                            {t.title}
                          </span>
                        </Link>
                      );
                    })}
                    {tasks.length > 3 && (
                      <span style={{ fontSize: 10, color: "var(--faint)", paddingLeft: 5 }}>
                        +{tasks.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
            marginBottom: "var(--space-2)" }}>
            No date given ({undated.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {undated.map((t) => (
              <Link key={t.id} href={`/queue/${t.commitment_id}`}
                style={{ display: "inline-flex" }}>
                <Badge tone="warn">{t.title}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const navButtonStyle: CSSProperties = {
  width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  color: "var(--text)", cursor: "pointer", fontSize: 15,
};
