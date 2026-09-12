"use client";

import type { CSSProperties, ReactNode } from "react";
import { StatusPill } from "./primitives";
import { AnimatedNumber } from "./AnimatedNumber";

export type StatTone = "neutral" | "ok" | "warn" | "danger" | "accent";

/** The text step for a tone, never the mark: a number is read, not measured. */
const FG: Record<StatTone, string> = {
  neutral: "var(--text)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger-text)",
  accent: "var(--accent-text)",
};

/**
 * A number with its meaning attached. A bare figure ("3") tells an owner nothing about
 * whether that is normal or on fire, so a tile carries a plain-language `status` line and
 * an optional `hint` naming the denominator the number came from.
 *
 * Values use the font's proportional figures, not tabular-nums: equal-width digits make a
 * large standalone number look loose. Tabular is for columns that align vertically.
 *
 * Tiles are all one width. The hero is set apart by the size of its figure, not by taking
 * two slots — a row of equal tiles keeps a clean baseline grid, and the type does the
 * ranking, which is cheaper than the layout doing it.
 */
export function StatTile({ label, value, tone = "neutral", status, hint, hero = false, index = 0 }: {
  label: string;
  value: string;
  tone?: StatTone;
  /** Text shipped alongside a non-neutral tone, so state is never colour alone. */
  status?: string;
  hint?: ReactNode;
  /** Exactly one per view. */
  hero?: boolean;
  /** Position in a row of tiles, so entrance staggers left to right instead of popping at once. */
  index?: number;
}) {
  // Values are always caller-formatted strings ("84%", "12"); animate only the numeric
  // portion so the count-up still lands on the exact string the caller composed.
  const match = /^(\D*)(-?\d+(?:\.\d+)?)(.*)$/.exec(value);
  const GLOW: Record<StatTone, string | undefined> = {
    neutral: undefined,
    accent: "var(--accent-quiet)",
    ok: "var(--ok-quiet)",
    warn: "var(--warn-quiet)",
    danger: "var(--danger-quiet)",
  };

  return (
    <div className={`cf-fade-up ${hero ? "cf-card-interactive cf-hero-glow" : "cf-card-interactive"}`}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "var(--space-4)",
        display: "flex", flexDirection: "column",
        animationDelay: `${index * 60}ms`,
        ...(hero ? { "--cf-glow-color": GLOW[tone] } as CSSProperties : {}),
      }}>
      <div style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{label}</div>
      <div style={{
        fontSize: hero ? 40 : "var(--text-xl)",
        lineHeight: 1.1,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        color: FG[tone],
        marginTop: hero ? "var(--space-2)" : "var(--space-1)",
      }}>
        {match
          ? <AnimatedNumber prefix={match[1]} value={Number(match[2])} suffix={match[3]} />
          : value}
      </div>
      {status && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <StatusPill tone={tone} label={status} />
        </div>
      )}
      {hint && (
        <div style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: status ? "var(--space-2)" : "var(--space-3)", lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
