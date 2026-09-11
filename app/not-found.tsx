import Link from "next/link";
import type { Metadata } from "next";
import { buttonStyle } from "@/components/ui/primitives";

/**
 * The default Next 404 is a white page in a product that is otherwise near-black, which
 * reads as a broken deployment rather than a wrong URL. This one is the same canvas, the
 * same type, and says the one useful thing: a signed-out visitor and a signed-in owner
 * want different doors out, so it offers both.
 */
export const metadata: Metadata = { title: "Not found" };

/**
 * Per request, for the CSP nonce — the same reason the marketing pages are. Prerendered
 * HTML has no nonce to match the one middleware.ts mints per request, so every inline
 * script Next emits is refused. A 404 that fails to hydrate still navigates, because its
 * links are real anchors, but it would fill the console with violations on the one page a
 * confused visitor is already looking at.
 */
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        justifyContent: "center", maxWidth: 960, marginInline: "auto",
        paddingInline: "var(--space-5)", paddingBlock: "var(--space-7)",
      }}
    >
      <p
        className="mono"
        style={{
          color: "var(--faint)", fontSize: "var(--text-xs)", letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        404
      </p>
      <h1
        style={{
          fontSize: "clamp(var(--text-xl), 3vw, var(--text-2xl))", letterSpacing: "-0.03em",
          lineHeight: 1.1, marginTop: "var(--space-3)", maxWidth: "20ch",
        }}
      >
        There is nothing at this address.
      </h1>
      <p
        style={{
          color: "var(--muted)", lineHeight: 1.7, marginTop: "var(--space-4)",
          maxWidth: "48ch",
        }}
      >
        Either the link was mistyped, or it points at something that has since been deleted.
        Nothing has gone wrong with your account.
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
        <Link href="/queue" style={{ ...buttonStyle("primary"), color: "#fff", padding: "10px 18px" }}>
          Back to the queue
        </Link>
        <Link href="/" style={{ ...buttonStyle("secondary"), padding: "10px 18px" }}>
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
