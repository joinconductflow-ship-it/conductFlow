"use client";
import { useEffect } from "react";

/**
 * Replaces the root layout, so it renders its own <html> and <body>. It deliberately
 * imports nothing from the design system: this boundary catches failures in the layout
 * itself, and an import that is what failed cannot be part of the page that reports it.
 * Styles are inlined and minimal for the same reason — globals.css may never have loaded.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server retains the full exception. The browser only needs a correlation digest.
    console.error("[conductflow] global failure", error.digest ? { digest: error.digest } : undefined);
  }, [error.digest]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <main style={{ padding: "32px", maxWidth: "40rem" }}>
          <h1 style={{ fontSize: "20px", margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
            Nothing was lost — no promise, task, or draft is changed by a failed page load.
          </p>
          <button type="button" onClick={reset}
            // Literal, not var(--radius): this boundary may render with globals.css
            // never loaded, and an unresolved variable would square the corner in
            // exactly the case this page exists for. Keep in step with --radius by hand.
            style={{ font: "inherit", padding: "7px 13px", borderRadius: "10px",
              border: "1px solid currentColor", background: "transparent", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
