"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDesktopToken, revokeDesktopToken } from "@/app/actions/desktop-tokens";
import {
  Card, CardTitle, Badge, SectionHeading, buttonStyle, fieldStyle, labelStyle,
} from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export interface TokenRow {
  id: string;
  label: string;
  created_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

function when(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });
}

export function DesktopTokens({ tokens }: { tokens: TokenRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Held in state, not re-fetched: the plaintext exists exactly once, in the reply to
  // the action that minted it. Navigating away loses it for good, which is the point.
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const live = tokens.filter((t) => !t.revoked_at);

  async function onCreate(formData: FormData) {
    setError(null);
    try {
      const { token } = await createDesktopToken(formData);
      setFresh(token);
      setCopied(false);
      router.refresh();
    } catch (err) {
      setError(presentError(err, {
        fallback: "Couldn't create that token right now. Try again.",
        authentication: "Please sign in again to create a desktop token.",
      }));
    }
  }

  return (
    <>
      <SectionHeading note="The desktop app signs in with one of these instead of a password.">
        Desktop tokens
      </SectionHeading>

      {fresh && (
        <Card tone="ok">
          <CardTitle tone="ok">Copy this now</CardTitle>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            This is the only time it will be shown. Paste it into the desktop app under
            Configuration, or save it to <code>~/Library/Application Support/conductFlow/.env</code>
            {" "}as <code>CONDUCTFLOW_TOKEN</code>.
          </p>
          <code style={{
            display: "block", padding: "10px 12px", borderRadius: 8, fontSize: 12,
            background: "rgba(0,0,0,.06)", wordBreak: "break-all", userSelect: "all",
          }}>{fresh}</code>
          <button
            type="button"
            style={{ ...buttonStyle("secondary"), marginTop: 10 }}
            onClick={() => {
              navigator.clipboard?.writeText(fresh).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >{copied ? "Copied" : "Copy to clipboard"}</button>
        </Card>
      )}

      <Card>
        <form action={(fd) => start(() => { void onCreate(fd); })}>
          <label style={labelStyle} htmlFor="label">Name this device</label>
          <input
            id="label" name="label" style={fieldStyle} maxLength={80}
            placeholder="My MacBook" defaultValue=""
          />
          <button type="submit" disabled={pending}
            style={{ ...buttonStyle("primary", pending), marginTop: 10 }}>
            {pending ? "Creating…" : "Create token"}
          </button>
        </form>
        {error && (
          <p style={{ color: "var(--danger, #b3261e)", fontSize: 13, marginTop: 10 }}>{error}</p>
        )}
      </Card>

      {live.length === 0 ? (
        <p style={{ fontSize: 13, opacity: .75, marginTop: 12 }}>
          No active tokens. The desktop app cannot reach this workspace until you create one.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12, display: "grid", gap: 8 }}>
          {live.map((t) => (
            <li key={t.id}>
              <Card padded>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13.5 }}>{t.label}</strong>
                    <div style={{ fontSize: 12, opacity: .7, marginTop: 2 }}>
                      created {when(t.created_at)} · last used {when(t.last_used_at)}
                    </div>
                  </div>
                  {!t.last_used_at && <Badge tone="neutral">unused</Badge>}
                  <form action={(fd) => start(() => { void revokeDesktopToken(fd); })}>
                    <input type="hidden" name="tokenId" value={t.id} />
                    <button type="submit" disabled={pending} style={buttonStyle("secondary", pending)}>
                      Revoke
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
