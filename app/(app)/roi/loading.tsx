import { pageStyle } from "@/components/ui/primitives";

/** Sized to StatTile's real shape (label + big figure) rather than a spinner. */
export default function RoiLoading() {
  return (
    <main style={pageStyle}>
      <div className="cf-skeleton" style={{ height: 28, width: 160,
        borderRadius: "var(--radius-sm)", background: "var(--raised)" }} />
      <div style={{ marginTop: "var(--space-5)", display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-3)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="cf-skeleton" style={{ padding: "var(--space-4)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            background: "var(--surface)" }}>
            <div style={{ height: 12, width: "50%", background: "var(--raised)",
              borderRadius: "var(--radius-sm)" }} />
            <div style={{ height: 28, width: "70%", marginTop: 10, background: "var(--raised)",
              borderRadius: "var(--radius-sm)" }} />
          </div>
        ))}
      </div>
    </main>
  );
}
