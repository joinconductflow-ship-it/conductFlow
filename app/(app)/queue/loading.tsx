import { pageStyle } from "@/components/ui/primitives";

/**
 * Matches CommitmentList's actual row geometry (padding: var(--space-4), a title line
 * plus a metadata line) rather than a generic spinner, so the page doesn't visibly
 * reflow once real rows replace these.
 */
export default function QueueLoading() {
  return (
    <main style={pageStyle}>
      <div style={{ height: 28, width: 220, borderRadius: "var(--radius-sm)",
        background: "var(--raised)" }} className="cf-skeleton" />
      <div style={{ marginTop: "var(--space-5)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", overflow: "hidden", background: "var(--surface)" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ padding: "var(--space-4)",
            borderTop: i === 0 ? "none" : "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: "var(--space-4)" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="cf-skeleton" style={{ height: 15, width: "60%",
                borderRadius: "var(--radius-sm)", background: "var(--raised)" }} />
              <div className="cf-skeleton" style={{ height: 11, width: "35%", marginTop: 6,
                borderRadius: "var(--radius-sm)", background: "var(--raised)" }} />
            </div>
            <div className="cf-skeleton" style={{ height: 20, width: 90, flexShrink: 0,
              borderRadius: "var(--radius-sm)", background: "var(--raised)" }} />
          </div>
        ))}
      </div>
    </main>
  );
}
