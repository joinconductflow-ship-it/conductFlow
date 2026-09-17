export const tokens = {
  color: {
    canvas: "#0A0A0B",
    surface: "#131316",
    border: "rgba(255,255,255,0.08)",
    text: "#EDEDEF",
    textMuted: "#9A9AA5",
    accent: "#6366F1",
    ok: "#3FB68B",
    warn: "#E0A23C",
    danger: "#E5484D",
  },
  /*
   * Mirrors the --radius-* custom properties in app/globals.css, which is the source of
   * truth: these are here for code that cannot reach a CSS variable. Nothing imports this
   * module today, so treat a disagreement as this file being stale, not the stylesheet.
   */
  radius: { sm: "6px", base: "10px", lg: "14px", pill: "999px" },
  space: (n: number) => `${n * 4}px`,
} as const;
export type Tokens = typeof tokens;
