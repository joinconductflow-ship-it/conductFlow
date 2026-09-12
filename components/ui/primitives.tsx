import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * The shared vocabulary every screen builds from. Server-safe by default — nothing here
 * holds state or handlers beyond what a caller passes, so a client screen and a server
 * screen can both render these.
 */

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

/**
 * Four jobs per tone, because one colour cannot do all four on a dark canvas:
 *   fg   — text, lifted until it clears 4.5:1 on the tone's own quiet fill
 *   bg   — the quiet fill a toned surface sits on
 *   line — the hairline around that surface; a full-strength border shouts
 *   mark — the solid dot, rail, or bar, where contrast is a 3:1 graphical requirement
 */
const TONE: Record<Tone, { fg: string; bg: string; line: string; mark: string }> = {
  neutral: { fg: "var(--muted)", bg: "transparent",
    line: "var(--border)", mark: "var(--muted)" },
  accent: { fg: "var(--accent-text)", bg: "var(--accent-quiet)",
    line: "var(--accent-line)", mark: "var(--accent)" },
  ok: { fg: "var(--ok)", bg: "var(--ok-quiet)",
    line: "var(--ok-line)", mark: "var(--ok)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-quiet)",
    line: "var(--warn-line)", mark: "var(--warn)" },
  danger: { fg: "var(--danger-text)", bg: "var(--danger-quiet)",
    line: "var(--danger-line)", mark: "var(--danger)" },
};

/**
 * The frame every screen is drawn in. One width for the whole app, so the nav bar and the
 * first character of every page share a left edge and navigating never shifts the column.
 * A screen that wants a narrower measure constrains its own content with `columnStyle`.
 */
export const pageStyle: CSSProperties = {
  maxWidth: "var(--shell)",
  marginInline: "auto",
  padding: "var(--space-6) var(--gutter) var(--space-7)",
};

/** A single readable column inside the frame: forms, settings, anything read top to bottom. */
export const columnStyle: CSSProperties = { maxWidth: 660 };

/** Long text that must stay readable: measure caps at ~68 characters. */
export const proseStyle: CSSProperties = { maxWidth: "68ch", lineHeight: 1.6 };

/** Uniform tiles, hierarchy from the type inside them rather than from tile width. */
export const statGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(184px, 1fr))",
  gap: "var(--space-3)",
};

/** The way back out of a detail screen, in the one place every detail screen puts it. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} style={{ display: "inline-flex", alignItems: "center",
      gap: "var(--space-2)", color: "var(--muted)", fontSize: "var(--text-sm)",
      marginBottom: "var(--space-4)" }}>
      <span aria-hidden>←</span>{children}
    </Link>
  );
}

/**
 * Title, optional lede, optional actions, optional counts. `meta` is the mono line of
 * figures an owner reads on arrival — it belongs to the header rather than floating above
 * the content, which is where three screens had independently put it.
 */
export function PageHeader({ title, lede, actions, meta }: {
  title: string; lede?: ReactNode; actions?: ReactNode; meta?: ReactNode;
}) {
  return (
    <header style={{ marginBottom: "var(--space-5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "var(--text-lg)" }}>{title}</h1>
        {actions && <div style={{ display: "flex", gap: "var(--space-2)",
          alignItems: "center" }}>{actions}</div>}
      </div>
      {lede && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
        maxWidth: "68ch", lineHeight: 1.55 }}>{lede}</p>}
      {meta && (
        <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
          marginTop: "var(--space-3)" }}>
          {meta}
        </p>
      )}
    </header>
  );
}

export function Card({ children, tone = "neutral", padded = true, interactive = false, style }: {
  children: ReactNode; tone?: Tone; padded?: boolean;
  /** Lifts and brightens on hover — for a card that leads somewhere or holds live data. */
  interactive?: boolean;
  style?: CSSProperties;
}) {
  const t = TONE[tone];
  return (
    <section className={interactive ? "cf-card-interactive" : undefined} style={{
      background: tone === "neutral" ? "var(--surface)" : t.bg,
      border: `1px solid ${tone === "neutral" ? "var(--border)" : t.line}`,
      borderRadius: "var(--radius)",
      padding: padded ? "var(--space-4)" : 0,
      ...style,
    }}>
      {children}
    </section>
  );
}

export function CardTitle({ children, tone = "neutral", dot = false }: {
  children: ReactNode; tone?: Tone; dot?: boolean;
}) {
  const t = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
      color: tone === "neutral" ? "var(--text)" : t.fg,
      fontWeight: 600, fontSize: "var(--text-base)", letterSpacing: "-0.01em" }}>
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999,
        background: t.mark, flexShrink: 0 }} />}
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: {
  children: ReactNode; tone?: Tone; title?: string;
}) {
  const t = TONE[tone];
  return (
    <span title={title} className="tabular" style={{
      display: "inline-flex", alignItems: "center", gap: "var(--space-1)",
      fontSize: "var(--text-xs)", fontWeight: 500, lineHeight: 1.5,
      padding: "1px 6px", borderRadius: "var(--radius-sm)",
      color: t.fg, background: t.bg,
      border: `1px solid ${tone === "neutral" ? "var(--border)" : t.line}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

/** Status is never colour alone: every dot ships with its label. */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
      fontSize: "var(--text-sm)", color: "var(--muted)", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: t.mark,
        flexShrink: 0 }} />
      {label}
    </span>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Every control in the app is one line tall and one of four skins. The backgrounds are
 * variable references rather than literals so the single :hover rule in globals.css can
 * repoint them — an inline style cannot express a hover state, but it can defer to one.
 *
 * Anchors styled as buttons need `className="cf-btn"` to pick that rule up; a real
 * <button> gets it from the element selector.
 */
export function buttonStyle(variant: ButtonVariant = "secondary", disabled = false): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: "var(--space-2)",
    borderRadius: "var(--radius-sm)", height: 30, padding: "0 11px",
    fontSize: "var(--text-base)", fontWeight: 500, lineHeight: 1,
    whiteSpace: "nowrap",
    transition: "background var(--motion), border-color var(--motion), "
      + "color var(--motion), opacity var(--motion)",
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
  };
  if (variant === "primary") {
    return { ...base, background: "var(--btn-bg-primary)", color: "#fff", fontWeight: 600 };
  }
  if (variant === "danger") {
    return { ...base, background: "var(--btn-bg-ghost)", color: "var(--danger-text)",
      borderColor: "var(--btn-border)" };
  }
  if (variant === "ghost") {
    return { ...base, background: "var(--btn-bg-ghost)", color: "var(--btn-fg-ghost)" };
  }
  return { ...base, background: "var(--btn-bg-secondary)", color: "var(--text)",
    borderColor: "var(--btn-border)" };
}

/**
 * Empty states carry the next action, not an apology. A screen with nothing on it is the
 * first thing a new customer sees, and "No data" teaches them nothing.
 */
export function EmptyState({ title, body, action }: {
  title: string; body: string; action?: ReactNode;
}) {
  return (
    <div style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--radius)",
      padding: "var(--space-7) var(--space-5)", textAlign: "center" }}>
      <div style={{ fontSize: "var(--text-md)", fontWeight: 600,
        letterSpacing: "-0.01em" }}>{title}</div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.55,
        maxWidth: "46ch", marginInline: "auto" }}>{body}</p>
      {action && <div style={{ marginTop: "var(--space-5)", display: "flex",
        justifyContent: "center" }}>{action}</div>}
    </div>
  );
}

/**
 * The small uppercase label above a group. Three screens hand-rolled this independently
 * before it lived here.
 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
      letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
      {children}
    </div>
  );
}

/**
 * The same label promoted to a real heading, with a rule under it. Five screens had each
 * written their own uppercase <h2> with slightly different letter-spacing; the rule is
 * what gives a long page its horizontal grid, so it belongs to the heading and not to
 * whoever remembered to add it.
 */
export function SectionHeading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
      gap: "var(--space-4)", marginBottom: "var(--space-3)",
      paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--muted)" }}>
        {children}
      </h2>
      {note && <span className="mono" style={{ color: "var(--faint)",
        fontSize: "var(--text-xs)", flexShrink: 0 }}>{note}</span>}
    </div>
  );
}

/**
 * A button whose label swaps while a server action runs. Width is reserved so the swap
 * cannot move anything beside it, and `aria-busy` says so to a screen reader.
 */
export function PendingButton({ pending, idleLabel, pendingLabel, variant = "secondary",
  onClick, type = "button", minWidth = 110, style }: {
  pending: boolean; idleLabel: string; pendingLabel: string;
  variant?: ButtonVariant; onClick?: () => void;
  type?: "button" | "submit"; minWidth?: number; style?: CSSProperties;
}) {
  return (
    <button type={type} onClick={onClick} disabled={pending} aria-busy={pending}
      style={{ ...buttonStyle(variant, pending), minWidth, ...style }}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return <div aria-hidden style={{ height, width, borderRadius: "var(--radius-sm)",
    background: "var(--raised)", animation: "cf-pulse 1.4s ease-in-out infinite" }} />;
}

export const fieldStyle: CSSProperties = {
  width: "100%", background: "var(--canvas)", color: "var(--text)",
  border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
  padding: "7px 10px", marginTop: "var(--space-2)",
  transition: "border-color var(--motion)",
};

export const labelStyle: CSSProperties = {
  display: "block", fontSize: "var(--text-sm)", color: "var(--muted)",
  marginTop: "var(--space-5)",
};
