"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TaskBoard } from "./TaskBoard";
import { TaskCalendar } from "./TaskCalendar";
import type { BoardTask } from "@/lib/db/queries";

type View = "calendar" | "board";

export function TaskViews({ items, nowIso }: { items: BoardTask[]; nowIso: string }) {
  const [view, setView] = useState<View>("calendar");

  return (
    <div>
      <div role="tablist" aria-label="Task view" style={{ display: "inline-flex", gap: 2,
        padding: 3, background: "var(--raised)", borderRadius: "var(--radius)",
        marginBottom: "var(--space-4)" }}>
        {(["calendar", "board"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className="cf-tab-btn"
            style={{
              padding: "5px 12px", fontSize: "var(--text-sm)", fontWeight: 600,
              border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
              background: view === v ? "var(--surface)" : "transparent",
              color: view === v ? "var(--text)" : "var(--muted)",
              transition: "background var(--motion), color var(--motion)",
            }}>
            {v === "calendar" ? "Calendar" : "Board"}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={view}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {view === "calendar"
            ? <TaskCalendar items={items} nowIso={nowIso} />
            : <TaskBoard items={items} nowIso={nowIso} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
