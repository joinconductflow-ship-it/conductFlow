"use client";

import { useState } from "react";
import { buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";

/**
 * Two ways in, separated by a rule rather than by one of them hiding under the other.
 * The word stays readable to a screen reader — it is the choice, not the decoration; only
 * the two hairlines are hidden.
 */
function OrRule() {
  const line = { flex: 1, height: 1, background: "var(--border)" } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
      margin: "var(--space-5) 0" }}>
      <span aria-hidden style={line} />
      <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
        letterSpacing: "0.08em", textTransform: "uppercase" }}>
        or
      </span>
      <span aria-hidden style={line} />
    </div>
  );
}

export function SignInControls() {
  const [accepted, setAccepted] = useState(false);

  return (
    <>
      <label style={{ ...labelStyle, display: "flex", alignItems: "start",
        gap: "var(--space-2)", lineHeight: 1.5 }}>
        <input type="checkbox" name="terms_accepted" value="true" required
          form="email-signin" checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          style={{ marginTop: 3, accentColor: "var(--accent)", flexShrink: 0 }} />
        <span>I agree to the <a href="/privacy" target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--accent-text)", textDecoration: "underline" }}>Privacy Policy</a>
          {" "}and <a href="/terms" target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--accent-text)", textDecoration: "underline" }}>Terms of Service</a>.
        </span>
      </label>
      <a href={accepted ? "/auth/signin?terms=accepted" : undefined}
        aria-disabled={!accepted} role="link" tabIndex={accepted ? 0 : -1} className="cf-btn" style={{
          ...buttonStyle("secondary", !accepted),
          background: "#fff", color: "#111", borderColor: "#fff", fontWeight: 600,
          width: "100%", height: 36, marginTop: "var(--space-5)",
        }}>
          Continue with Google
      </a>

      <OrRule />

      {/* Submission remains a native POST; JavaScript only gates the controls. */}
      <form id="email-signin" action="/auth/email" method="post">
        <label style={{ ...labelStyle, marginTop: 0 }}>
          Email address
          <input name="email" type="email" required autoComplete="email"
            placeholder="you@yourcompany.com" style={fieldStyle} />
        </label>
        <button type="submit" disabled={!accepted} style={{ ...buttonStyle("secondary", !accepted), width: "100%",
          height: 36, marginTop: "var(--space-3)" }}>
          Email me a sign-in link
        </button>
      </form>

    </>
  );
}
