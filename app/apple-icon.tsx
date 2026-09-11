import { ImageResponse } from "next/og";

/**
 * The icon iOS uses when someone adds the app to their home screen. Without it, Safari
 * screenshots the page and crops it, which on a near-black ops tool produces an
 * unreadable grey square.
 *
 * Generated from the same two tokens the product's only mark uses — the accent, on the
 * canvas — so it cannot drift from globals.css. No transparency: iOS squares off and
 * composites these onto white, and a transparent ground would show through as a white tile.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center",
          justifyContent: "center", backgroundColor: "#0A0A0B",
        }}
      >
        {/* The same accent bar as the social card, scaled to the tile. */}
        <div style={{ display: "flex", width: 26, height: 104, backgroundColor: "#5B5EF0", borderRadius: 13 }} />
      </div>
    ),
    size
  );
}
