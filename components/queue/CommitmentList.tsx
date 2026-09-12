"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Commitment } from "@/lib/types";
import { Badge, EmptyState, SectionHeading, StatusPill, buttonStyle } from "@/components/ui/primitives";

type Risk = "overdue" | "flagged" | "unowned" | "uncertain" | "none";
export type CommitmentFilter = "all" | "review" | "overdue" | "approved" | "done";
type UrgencyGroup = "overdue" | "due_soon" | "later" | "no_date" | "done";

const FILTERS: Array<{ key: CommitmentFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "overdue", label: "Overdue" },
  { key: "approved", label: "Approved" },
  { key: "done", label: "Done" },
];

const GROUPS: Array<{ key: UrgencyGroup; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon" },
  { key: "later", label: "Later" },
  { key: "no_date", label: "No due date" },
  { key: "done", label: "Done" },
];

const RAIL: Record<Risk, string> = {
  overdue: "var(--danger)",
  flagged: "var(--warn)",
  unowned: "var(--warn)",
  uncertain: "var(--warn)",
  none: "transparent",
};

function parsedTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isCommitmentOverdue(c: Commitment, nowMs = Date.now()): boolean {
  const deadline = parsedTime(c.deadline);
  return c.status !== "done" && deadline !== null && deadline < nowMs;
}

function dateKey(value: string | null): string | null {
  const time = parsedTime(value);
  return time === null ? null : new Date(time).toISOString().slice(0, 10);
}

function dayNumber(value: string | null): number | null {
  const key = dateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function riskOf(c: Commitment, nowMs: number): Risk {
  if (isCommitmentOverdue(c, nowMs)) return "overdue";
  if (c.source_flagged) return "flagged";
  if (!c.owner) return "unowned";
  if (c.confidence === "low") return "uncertain";
  return "none";
}

function urgencyOf(c: Commitment, nowIso: string, nowMs: number): UrgencyGroup {
  if (c.status === "done") return "done";
  if (isCommitmentOverdue(c, nowMs)) return "overdue";
  const dueDay = dayNumber(c.deadline);
  const today = dayNumber(nowIso);
  if (dueDay === null || today === null) return "no_date";
  return dueDay - today <= 7 ? "due_soon" : "later";
}

function matchesFilter(c: Commitment, filter: CommitmentFilter, nowMs: number): boolean {
  if (filter === "review") return c.status === "proposed";
  if (filter === "overdue") return isCommitmentOverdue(c, nowMs);
  if (filter === "approved") return c.status === "approved" || c.status === "tasked";
  if (filter === "done") return c.status === "done";
  return true;
}

function statusPill(c: Commitment, risk: Risk) {
  if (risk === "overdue") return <StatusPill tone="danger" label="overdue" />;
  if (c.status === "done") return <StatusPill tone="ok" label="delivered" />;
  if (c.status === "tasked") return <StatusPill tone="accent" label="on the board" />;
  if (c.status === "approved") return <StatusPill tone="accent" label="approved" />;
  return <StatusPill tone="neutral" label="awaiting review" />;
}

function CommitmentRows({ items, nowMs }: { items: Commitment[]; nowMs: number }) {
  return (
    <ul className="queue-commitment-list" style={{ listStyle: "none", padding: 0, margin: 0,
      border: "1px solid var(--border)", borderRadius: "var(--radius)",
      overflow: "hidden", background: "var(--surface)" }}>
      {items.map((c, i) => {
        const risk = riskOf(c, nowMs);
        const due = dateKey(c.deadline);
        return (
          <li key={c.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
            <Link href={`/queue/${c.id}`} className="cf-row queue-commitment-row" style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "var(--space-4)", color: "var(--text)",
              padding: "var(--space-4)",
              borderLeft: `2px solid ${RAIL[risk]}`,
            }}>
              <span className="queue-commitment-main" style={{ minWidth: 0 }}>
                <span style={{ fontSize: "var(--text-md)", fontWeight: 600,
                  display: "block", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }}>
                  {c.text}
                </span>
                <span className="mono" style={{ display: "block", color: "var(--faint)",
                  fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
                  {due ?? "no date"} · {c.owner ?? "no owner"}
                </span>
              </span>

              <span className="queue-commitment-status" style={{ display: "flex", alignItems: "center",
                gap: "var(--space-3)", flexShrink: 0 }}>
                {c.source_flagged && (
                  <Badge tone="warn" title="This transcript contained instruction-like text">
                    flagged source
                  </Badge>
                )}
                {c.confidence !== "high" && (
                  <Badge tone={c.confidence === "low" ? "warn" : "neutral"}
                    title={`Extraction confidence: ${c.confidence}`}>
                    {c.confidence} confidence
                  </Badge>
                )}
                {statusPill(c, risk)}
                <span aria-hidden className="cf-row-go" style={{ color: "var(--faint)",
                  opacity: 0.4, transition: "opacity var(--motion), transform var(--motion)" }}>
                  →
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function CommitmentList({ items, nowIso = new Date().toISOString() }: {
  items: Commitment[]; nowIso?: string;
}) {
  const [filter, setFilter] = useState<CommitmentFilter>("all");
  const nowMs = parsedTime(nowIso) ?? Date.now();

  const counts = useMemo(() => ({
    all: items.length,
    review: items.filter((c) => c.status === "proposed").length,
    overdue: items.filter((c) => isCommitmentOverdue(c, nowMs)).length,
    approved: items.filter((c) => c.status === "approved" || c.status === "tasked").length,
    done: items.filter((c) => c.status === "done").length,
  }), [items, nowMs]);

  const visible = useMemo(
    () => items.filter((c) => matchesFilter(c, filter, nowMs)),
    [items, filter, nowMs],
  );

  const groups = useMemo(() => GROUPS.map((group) => ({
    ...group,
    items: visible.filter((c) => urgencyOf(c, nowIso, nowMs) === group.key),
  })).filter((group) => group.items.length > 0), [visible, nowIso, nowMs]);

  return (
    <section className="queue-commitments" aria-label="Commitments">
      <SectionHeading note={`${items.length} total`}>Commitments</SectionHeading>

      {items.length === 0 ? (
        <EmptyState
          title="No promises yet"
          body="Paste or upload a client conversation and ConductFlow pulls out what was promised, who owes it, and when."
          action={<Link href="/ingest" className="cf-btn"
            style={buttonStyle("primary")}>Add a transcript</Link>}
        />
      ) : (
        <>
          <div className="queue-filter-strip" role="group" aria-label="Commitment filters">
            {FILTERS.map(({ key, label }) => {
              const active = filter === key;
              return (
                <button key={key} type="button" aria-pressed={active} onClick={() => setFilter(key)}
                  style={{ ...buttonStyle(active ? "secondary" : "ghost"), height: 28 }}>
                  {label} <span className="mono" aria-label={`${counts[key]} commitments`}>
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <p className="queue-filter-empty" role="status">No commitments in this view.</p>
          ) : (
            <div className="queue-commitment-groups">
              {groups.map((group) => (
                <section key={group.key} aria-label={group.label} className="queue-commitment-group">
                  <div className="queue-group-heading">
                    <h3>{group.label}</h3>
                    <span className="mono">{group.items.length}</span>
                  </div>
                  <CommitmentRows items={group.items} nowMs={nowMs} />
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
