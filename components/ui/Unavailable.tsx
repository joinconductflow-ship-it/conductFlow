/** Small, non-technical fallback shared by server and client sections. */
export function Unavailable({ section }: { section: string }) {
  return <p role="status" className="cf-empty-state" style={{ color: "var(--muted)",
    fontSize: "var(--text-sm)", display: "flex", alignItems: "center",
    gap: "var(--space-2)" }}>
    <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%",
      background: "var(--warn)", flexShrink: 0 }} />
    {section} temporarily unavailable. Please refresh to try again.
  </p>;
}
