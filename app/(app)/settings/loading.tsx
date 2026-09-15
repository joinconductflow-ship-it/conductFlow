import { pageStyle } from "@/components/ui/primitives";

/** Same skeleton approach as Queue/Tasks, sized to Settings' actual connection cards. */
export default function SettingsLoading() {
  return (
    <main style={pageStyle}>
      <div className="cf-skeleton" style={{ height: 28, width: 140,
        borderRadius: "var(--radius-sm)", background: "var(--raised)" }} />
      <div style={{ marginTop: "var(--space-5)", display: "grid", gap: "var(--space-4)" }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="cf-skeleton" style={{ height: 140, borderRadius: "var(--radius)",
            border: "1px solid var(--border)", background: "var(--surface)" }} />
        ))}
      </div>
    </main>
  );
}
