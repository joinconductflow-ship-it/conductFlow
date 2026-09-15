"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveEscalation } from "@/app/actions/escalations";
import type { OpenEscalation } from "@/lib/db/queries";
import { Card, CardTitle, Badge, buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

const LABELS: Record<string, { title: string; why: string }> = {
  complaint: {
    title: "Complaint",
    why: "Somebody is unhappy. Read the conversation before any follow-up goes out.",
  },
  legal_concern: {
    title: "Legal concern",
    why: "Legal language appeared. This is above what the assistant may answer.",
  },
  missing_owner_or_deadline: {
    title: "Unowned promise",
    why: "A promise was made with nobody on the hook or no date. It will be missed by default.",
  },
  unusual_lead_time: {
    title: "Unusual timing",
    why: "This deadline sits well outside how far ahead you normally promise.",
  },
  unusual_type_for_client: {
    title: "Unusual for this client",
    why: "You have not promised this kind of thing to this client before.",
  },
  volume_spike: {
    title: "Unusually many promises",
    why: "This conversation produced far more commitments than usual. Worth a skim.",
  },
  new_client: {
    title: "First promise to a new client",
    why: "Expectations get set here, so it is worth reading once.",
  },
};

/**
 * Contract escalations stop the line; exception checks are advisory. Ranking them keeps a
 * run of "unusual timing" notes from burying a complaint sitting underneath them.
 */
const SERIOUS = new Set(["complaint", "legal_concern", "missing_owner_or_deadline"]);

const VISIBLE_LIMIT = 5;

export function EscalationStrip({ items }: { items: OpenEscalation[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const ranked = [...items].sort(
    (a, b) => Number(SERIOUS.has(b.kind)) - Number(SERIOUS.has(a.kind)));
  const seriousCount = items.filter((e) => SERIOUS.has(e.kind)).length;
  // Exception checks can raise one of these per commitment, so a busy week produces
  // dozens. An unbounded list buries the queue it sits above — the serious ones sort
  // first, and the rest stay one click away rather than pushing the work off-screen.
  const visible = expanded ? ranked : ranked.slice(0, VISIBLE_LIMIT);
  const hidden = ranked.length - visible.length;

  function act(id: string) {
    setError(null);
    setClearing(id);
    startTransition(async () => {
      try { await resolveEscalation(id, "resolved"); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't resolve this decision. Try again." })); }
    });
  }

  return (
    <Card tone="neutral" className="queue-decision-inbox" style={{ marginBottom: "var(--space-6)", borderLeft: "3px solid var(--warn)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-3)", flexWrap: "wrap" }}>
        <CardTitle tone="warn" dot>Needs your decision</CardTitle>
        <span className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>
          {seriousCount > 0 ? `${seriousCount} to read · ` : ""}{items.length} open
        </span>
      </div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "68ch" }}>
        The assistant stopped short of these. Nothing about them has been sent or acted on.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {visible.map((e) => {
          const label = LABELS[e.kind] ?? { title: e.kind, why: "" };
          const serious = SERIOUS.has(e.kind);
          const busy = isPending && clearing === e.id;
          return (
            <li key={e.id} className="queue-decision-row" style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: "var(--space-4)",
              padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                  flexWrap: "wrap" }}>
                  <Badge tone={serious ? "warn" : "neutral"}>{label.title}</Badge>
                  <span className="mono" style={{ color: "var(--faint)",
                    fontSize: "var(--text-xs)" }}>
                    From {e.conversation_title}
                  </span>
                </span>
                <span style={{ display: "block", marginTop: "var(--space-2)" }}>{e.detail}</span>
                <span style={{ display: "block", color: "var(--muted)",
                  fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>
                  {label.why}
                </span>
              </span>

              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                flexShrink: 0 }}>
                {e.commitment_id && (
                  <Link href={`/queue/${e.commitment_id}`} className="cf-btn"
                    style={buttonStyle("ghost")}>
                    Review
                  </Link>
                )}
                <button disabled={isPending} aria-busy={busy} onClick={() => act(e.id)}
                  style={{ ...buttonStyle("secondary", isPending), minWidth: 96,
                    justifyContent: "center" }}>
                  {busy ? "Clearing…" : "Mark resolved"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button onClick={() => setExpanded(true)}
          style={{ ...buttonStyle("ghost"), marginTop: "var(--space-3)" }}>
          Show {hidden} more
        </button>
      )}
      {expanded && ranked.length > VISIBLE_LIMIT && (
        <button onClick={() => setExpanded(false)}
          style={{ ...buttonStyle("ghost"), marginTop: "var(--space-3)" }}>
          Show fewer
        </button>
      )}

      {error && (
        <p role="alert" className="cf-empty-state" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>
          That could not be cleared.{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>{error}</span>
        </p>
      )}
    </Card>
  );
}
