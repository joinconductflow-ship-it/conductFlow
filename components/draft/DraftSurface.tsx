import type { DeliverableDraft } from "@/lib/types";
import { Badge, proseStyle } from "@/components/ui/primitives";

/**
 * The artifact under review. It gets an accent rail and its own surface so there is never
 * a question about which words on this page were written by a machine.
 */
export function DraftSurface({ draft, provenance, expectsEmailDraft }:
  { draft: DeliverableDraft | null; provenance: string[]; expectsEmailDraft: boolean }) {
  return (
    <section style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderLeft: "2px solid var(--accent)",
      borderRadius: "var(--radius)",
    }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-3)", flexWrap: "wrap",
        padding: "var(--space-3) var(--space-4)",
        borderBottom: "1px solid var(--border)" }}>
        <span className="mono" style={{ color: "var(--accent-text)", fontWeight: 600,
          fontSize: "var(--text-xs)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Drafted by ConductFlow
        </span>
        <Badge tone="neutral" title="ConductFlow has no ability to send mail at all">
          never auto-sends
        </Badge>
      </header>

      <div style={{ padding: "var(--space-4)" }}>
        {draft ? (
          <>
            {draft.subject && (
              <div style={{ fontSize: "var(--text-md)", fontWeight: 600,
                letterSpacing: "-0.01em", marginBottom: "var(--space-3)" }}>
                {draft.subject}
              </div>
            )}
            <p style={{ ...proseStyle, whiteSpace: "pre-wrap" }}>{draft.body}</p>
          </>
        ) : expectsEmailDraft ? (
          <p style={{ ...proseStyle, color: "var(--muted)" }}>
            Draft generation did not finish. Try writing the draft again.
          </p>
        ) : (
          <p style={{ ...proseStyle, color: "var(--muted)" }}>
            No email draft was requested for this commitment.
          </p>
        )}
      </div>

      <footer className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
        padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--border)" }}>
        read: {provenance.join(" · ")}
      </footer>
    </section>
  );
}
