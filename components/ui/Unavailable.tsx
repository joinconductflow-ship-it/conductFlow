/** Small, non-technical fallback shared by server and client sections. */
export function Unavailable({ section }: { section: string }) {
  return <p role="status" style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
    {section} temporarily unavailable. Please refresh to try again.
  </p>;
}
