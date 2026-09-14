import { pageStyle } from "@/components/ui/primitives";

/**
 * Same skeleton approach as app/(app)/queue/loading.tsx, sized for the calendar grid's
 * actual cell height (minHeight: 116 in TaskCalendar) rather than a generic spinner.
 */
export default function TasksLoading() {
  return (
    <main style={pageStyle}>
      <div className="cf-skeleton" style={{ height: 28, width: 180,
        borderRadius: "var(--radius-sm)", background: "var(--raised)" }} />
      <div style={{ marginTop: "var(--space-5)", display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1 }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="cf-skeleton" style={{ minHeight: 116,
            background: "var(--surface)", border: "1px solid var(--border)" }} />
        ))}
      </div>
    </main>
  );
}
