import type { ReactNode } from "react";

type BarTone = "accent" | "warn" | "danger" | "ok";

/**
 * A labelled magnitude bar. Every bar in a group wears the same hue — darkening the big
 * ones would double-encode length as colour and spend the only free channel on something
 * the bar already says. The value text stays in a text token, never the mark's colour.
 */
export function MeasureRow({ label, count, max, value, tone = "accent" }: {
  label: ReactNode;
  count: number;
  max: number;
  value: ReactNode;
  tone?: BarTone;
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, count / max)) : 0;
  return (
    <div style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: "var(--space-4)" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
          flexShrink: 0 }}>
          {value}
        </span>
      </div>
      {/* Neutral track, coloured fill: a tinted track spends the tone on the part of the
          bar that carries no reading, and dulls the boundary the eye actually measures. */}
      <div aria-hidden style={{ height: 4, borderRadius: "var(--radius-pill)", marginTop: "var(--space-2)",
        background: "var(--raised)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${share * 100}%`, borderRadius: "var(--radius-pill)",
          background: `var(--${tone})` }} />
      </div>
    </div>
  );
}

/**
 * A two-part proportion where the parts are complements and therefore genuinely sum to a
 * whole — unlike the per-type shares, which round independently and must never be drawn
 * as one stacked bar claiming 100%.
 *
 * Both ends are labelled, so the split is readable without interpreting the fill.
 */
export function Meter({ pct, tone, filledLabel, emptyLabel }: {
  pct: number;
  tone: BarTone;
  filledLabel: string;
  emptyLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div style={{ height: 6, borderRadius: "var(--radius-pill)", background: "var(--raised)",
        overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${clamped}%`, borderRadius: "var(--radius-pill)",
          background: `var(--${tone})` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between",
        gap: "var(--space-4)", marginTop: "var(--space-3)",
        fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <span>{filledLabel}</span>
        <span>{emptyLabel}</span>
      </div>
    </div>
  );
}
