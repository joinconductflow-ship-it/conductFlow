import { ImageResponse } from "next/og";

/**
 * The card that appears when someone pastes a link to this product into Slack, iMessage,
 * or a tweet. Without one, the link renders as a bare grey rectangle — which is what it
 * did until now.
 *
 * Generated rather than committed as a PNG so it cannot drift from the palette in
 * globals.css. It uses the same near-black canvas, the same accent, and the same sentence
 * the landing page opens with, because a card that promises a different product than the
 * page it links to is worse than no card.
 *
 * Only system fonts are used. A custom face would have to be fetched and embedded at
 * render time, and the mono/sans split is not worth that cost at this size.
 */
export const alt = "ConductFlow — you said you'd send it by Friday.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", backgroundColor: "#0A0A0B", padding: 80,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* The accent bar is the only mark the product has; a logo would be inventing one. */}
          <div style={{ width: 6, height: 34, backgroundColor: "#5B5EF0", borderRadius: 3 }} />
          <div style={{ fontSize: 30, color: "#EDEDEF", fontWeight: 600, letterSpacing: -0.5 }}>
            ConductFlow
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              fontSize: 76, color: "#EDEDEF", fontWeight: 600, letterSpacing: -2.6,
              lineHeight: 1.06, maxWidth: 900, display: "flex",
            }}
          >
            You said you&apos;d send it by Friday.
          </div>
          <div style={{ fontSize: 30, color: "#9A9AA5", lineHeight: 1.45, maxWidth: 840, display: "flex" }}>
            ConductFlow finds the promises in your client calls and drafts the follow-ups.
          </div>
        </div>

        <div
          style={{
            display: "flex", alignItems: "center", gap: 14, fontSize: 23, color: "#868692",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          }}
        >
          <div style={{ display: "flex", width: 9, height: 9, borderRadius: 5, backgroundColor: "#3FB68B" }} />
          nothing sends without you
        </div>
      </div>
    ),
    size
  );
}
