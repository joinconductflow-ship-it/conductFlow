"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  add, eachDayOfInterval, endOfMonth, endOfWeek, format, isBefore,
  isEqual, isSameDay, isSameMonth, parseISO, startOfDay, startOfMonth, startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, buttonStyle } from "@/components/ui/primitives";
import type { BoardTask } from "@/lib/db/queries";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Urgency = "late" | "today" | "clear" | "delivered";
const COLORS: Record<Urgency, string> = {
  late: "var(--danger)", today: "var(--warn)",
  clear: "var(--muted)", delivered: "var(--ok)",
};

function urgencyOf(task: BoardTask, today: Date): Urgency {
  if (task.status === "done") return "delivered";
  if (!task.due) return "clear";
  const due = parseISO(task.due);
  if (isSameDay(due, today)) return "today";
  return isBefore(due, today) ? "late" : "clear";
}

export function TaskCalendar({ items, nowIso }: { items: BoardTask[]; nowIso: string }) {
  // Use the supplied clock so the initial server and client renders agree.
  const today = startOfDay(parseISO(nowIso));
  const [cursor, setCursor] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(() => today);
  const byDay = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const task of items) {
      if (!task.due) continue;
      const key = format(parseISO(task.due), "yyyy-MM-dd");
      const tasks = map.get(key) ?? [];
      tasks.push(task);
      map.set(key, tasks);
    }
    return map;
  }, [items]);
  const undated = items.filter((task) => !task.due);
  const cells = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const monthEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    const sixthWeekEnd = endOfWeek(add(start, { weeks: 5 }), { weekStartsOn: 0 });
    return eachDayOfInterval({
      start, end: isBefore(monthEnd, sixthWeekEnd) ? sixthWeekEnd : monthEnd,
    });
  }, [cursor]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div aria-label={`Today, ${format(today, "MMMM d, yyyy")}`} style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            width: 46, height: 50, flexShrink: 0, background: "var(--raised)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
          }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
              {format(today, "MMM")}
            </span>
            <span style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text)" }}>
              {format(today, "d")}
            </span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 600 }}>
              {format(cursor, "MMMM yyyy")}
            </h2>
            <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
              {format(cells[0], "MMM d, yyyy")} - {format(cells[cells.length - 1], "MMM d, yyyy")}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <div role="group" aria-label="Calendar navigation" style={{ display: "inline-flex",
            border: "1px solid var(--border)", borderRadius: "var(--radius-pill)",
            overflow: "hidden" }}>
            <button type="button" aria-label="Previous month" style={navButtonStyle}
              onClick={() => setCursor((month) => add(month, { months: -1 }))}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" style={{ ...navButtonStyle, width: "auto", padding: "0 12px",
              borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}
              onClick={() => { setCursor(startOfMonth(today)); setSelected(today); }}>
              Today
            </button>
            <button type="button" aria-label="Next month" style={navButtonStyle}
              onClick={() => setCursor((month) => add(month, { months: 1 }))}>
              <ChevronRight size={16} />
            </button>
          </div>
          <Link href="/ingest" className="cf-btn" style={buttonStyle("primary")}>New task</Link>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)",
        overflow: "hidden", background: "var(--border)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1,
          marginBottom: 1 }}>
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} style={{ background: "var(--raised)", padding: "6px 8px",
              fontSize: "var(--text-xs)", color: "var(--faint)", textAlign: "center",
              fontWeight: 600, letterSpacing: "0.02em" }}>{weekday}</div>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={format(cursor, "yyyy-MM")}
            initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}
            style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1 }}>
            {cells.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const tasks = byDay.get(key) ?? [];
              const currentDay = isSameDay(day, today);
              const selectedDay = isEqual(day, selected);
              const highlighted = currentDay || selectedDay;
              return (
                <div key={key} onClick={() => setSelected(day)} className="task-calendar-day" style={{
                  background: "var(--surface)", minHeight: 116, minWidth: 0,
                  padding: "var(--space-2)", opacity: isSameMonth(day, cursor) ? 1 : 0.35,
                  display: "flex", flexDirection: "column", gap: "var(--space-1)", cursor: "pointer",
                }}>
                  <button type="button" aria-label={format(day, "EEEE, MMMM d, yyyy")}
                    aria-pressed={selectedDay} aria-current={currentDay ? "date" : undefined}
                    onClick={() => setSelected(day)} style={{
                      display: "inline-flex", width: 26, height: 26, alignItems: "center",
                      justifyContent: "center", flexShrink: 0, padding: 0, border: 0, borderRadius: "var(--radius-pill)",
                      background: highlighted ? "var(--accent)" : "transparent",
                      color: highlighted ? "#fff" : "var(--faint)", cursor: "pointer",
                      fontSize: "var(--text-xs)", fontWeight: highlighted ? 700 : 400,
                    }}>{format(day, "d")}</button>
                  {tasks.slice(0, 1).map((task) => {
                    const urgency = urgencyOf(task, today);
                    const label = urgency === "delivered" ? "Delivered"
                      : urgency === "late" ? "Overdue"
                      : urgency === "today" ? "Due today" : `Due ${format(day, "MMM d")}`;
                    return (
                      <Link key={task.id} href={`/queue/${task.commitment_id}`} title={task.title}
                        className="task-calendar-card"
                        onClick={(event) => event.stopPropagation()} style={{
                          display: "flex", flexDirection: "column", gap: 3, minWidth: 0,
                          padding: "var(--space-1) var(--space-2)", borderRadius: "var(--radius-sm)",
                          background: "var(--raised)", borderLeft: `2px solid ${COLORS[urgency]}`,
                          opacity: urgency === "delivered" ? 0.6 : 1, fontSize: "var(--text-xs)",
                          lineHeight: 1.4, textDecoration: "none",
                        }}>
                        <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                          color: urgency === "clear" ? "var(--text)" : COLORS[urgency],
                          textDecoration: urgency === "delivered" ? "line-through" : "none" }}>
                          {task.title}
                        </span>
                        <span style={{ color: COLORS[urgency] }}>{label}</span>
                      </Link>
                    );
                  })}
                  {tasks.length > 1 && (
                    <span className="task-calendar-card" style={{ fontSize: "var(--text-xs)",
                      color: "var(--muted)", paddingLeft: 5 }}>
                      +{tasks.length - 1} more
                    </span>
                  )}
                  {tasks.length > 0 && (
                    <div className="task-calendar-dots" aria-hidden>
                      {tasks.slice(0, 4).map((task) => (
                        <span key={task.id} style={{ width: 5, height: 5, borderRadius: "var(--radius-pill)",
                          background: COLORS[urgencyOf(task, today)] }} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div style={{ color: "var(--faint)", fontSize: "var(--text-sm)", marginBottom: "var(--space-2)" }}>
            No date given ({undated.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {undated.map((task) => (
              <Link key={task.id} href={`/queue/${task.commitment_id}`}
                style={{ display: "inline-flex", opacity: task.status === "done" ? 0.6 : 1 }}>
                <Badge tone={task.status === "done" ? "ok" : "neutral"}>{task.title}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const navButtonStyle: CSSProperties = {
  width: 32, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
  // Square on purpose: the role="group" wrapper above is the pill, and it clips these
  // with overflow: hidden. A radius here would be invisible at the ends and would break
  // the seam between the three buttons in the middle.
  background: "var(--raised)", border: 0, borderRadius: 0,
  color: "var(--text)", cursor: "pointer", fontSize: "var(--text-sm)",
};
