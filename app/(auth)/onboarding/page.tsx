import { signInAsDemoOwner } from "@/app/actions/dev-auth";
import { Card, CardTitle, buttonStyle } from "@/components/ui/primitives";

import { SignInControls } from "./sign-in-controls";
import { presentErrorText } from "@/lib/errors/presentation";

export const dynamic = "force-dynamic";

/** What actually happens after the button, in the order it happens. */
const NEXT = [
  "Your workspace is created — just you, until you invite anyone.",
  "Add one client conversation and see what the assistant finds in it.",
  "Connect Gmail, Drive, or Calendar later, one at a time, only if you want to.",
];

export default async function Onboarding({ searchParams }:
  { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  const safeError = presentErrorText(error, {
    fallback: "Sign-in could not be completed. Please try again.",
    authentication: "Sign-in could not be completed. Please try again.",
    provider: "Google sign-in is temporarily unavailable. Please try again.",
  });
  // The dev stub also requires a loopback Supabase URL, so a dev build pointed at the
  // hosted project cannot mint a session there. See app/actions/dev-auth.ts.
  const dev = process.env.NODE_ENV !== "production";

  return (
    <main style={{ maxWidth: 440, margin: "0 auto",
      padding: "var(--space-7) var(--gutter)" }}>
      <p className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
        letterSpacing: "0.08em", textTransform: "uppercase" }}>
        ConductFlow
      </p>
      <h1 style={{ fontSize: "var(--text-xl)", marginTop: "var(--space-3)" }}>
        Set up your workspace
      </h1>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.6 }}>
        Continue with Google, or have a sign-in link emailed to you. Either way, we never ask
        for a password.
      </p>

      <SignInControls />

      {sent && (
        <Card tone="ok" className="cf-empty-state" style={{ marginTop: "var(--space-4)" }}>
          <CardTitle tone="ok" dot>Check your inbox</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.5 }}>
            Check{" "}
            <span className="mono" style={{ color: "var(--text)", wordBreak: "break-word" }}>
              {sent}
            </span>{" "}
            for a sign-in link. Opening it signs you in here — there is nothing else to enter.
          </p>
        </Card>
      )}

      {safeError && (
        <Card tone="danger" className="cf-empty-state" style={{ marginTop: "var(--space-4)" }}>
          <CardTitle tone="danger" dot>Sign-in failed</CardTitle>
          <p className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)", wordBreak: "break-word" }}>
            {safeError}
          </p>
        </Card>
      )}

      <Card style={{ marginTop: "var(--space-5)" }}>
        <div style={{ fontWeight: 600 }}>What happens next</div>
        <ol style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0",
          display: "grid", gap: "var(--space-3)" }}>
          {NEXT.map((line, i) => (
            <li key={line} style={{ display: "grid", gridTemplateColumns: "auto 1fr",
              gap: "var(--space-3)", alignItems: "start" }}>
              <span className="mono" aria-hidden style={{ color: "var(--faint)",
                fontSize: "var(--text-sm)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ color: "var(--muted)", lineHeight: 1.5 }}>{line}</span>
            </li>
          ))}
        </ol>
        <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
          marginTop: "var(--space-4)", lineHeight: 1.5 }}>
          Continuing with Google asks for your name and email — nothing else. A sign-in link
          involves Google not at all; it only proves you can read that mailbox. Either way,
          access to Gmail, Drive, and Calendar is asked for separately, and only when you turn
          that capability on.
        </p>
      </Card>

      {dev && (
        <form action={signInAsDemoOwner} style={{ marginTop: "var(--space-6)",
          paddingTop: "var(--space-5)", borderTop: "1px solid var(--border)" }}>
          <button type="submit" style={buttonStyle("secondary")}>
            Continue as demo owner
          </button>
          <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
            marginTop: "var(--space-3)" }}>
            local development only · owner@demo.test
          </p>
        </form>
      )}
    </main>
  );
}
