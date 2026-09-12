"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startConnect, disconnectGoogle } from "@/app/actions/connect";
import { TemplatePicker } from "@/components/settings/TemplatePicker";
import { Card, CardTitle, Badge, SectionHeading, buttonStyle } from "@/components/ui/primitives";

interface CapabilityRow {
  key: string; label: string; detail: string;
  scopes: readonly string[]; connected: boolean;
}
interface ConnectionRow {
  id: string; account_email: string; scopes: string[]; state: string; created_at: string;
}

/**
 * What each grant does NOT allow, in the owner's terms. The scope string alone is a fact
 * nobody can read; the reassurance is the reason they'd say yes.
 *
 * Deliberately does not claim the *scope* prevents sending — gmail.compose technically
 * permits it. The guarantee is that this product contains no send call at all.
 */
const LIMITS: Record<string, string> = {
  drive_templates: "Cannot see any other file in your Drive.",
  calendar_context: "Read-only. Cannot create, move, or cancel anything.",
  gmail_drafts: "Only writes drafts. ConductFlow has no ability to send mail at all.",
  gmail_watch: "Read-only. Cannot send, delete, or modify anything in your inbox.",
};

const STATE_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  active: "ok", revoked: "neutral", error: "danger",
};

export function ConnectionList({ capabilities, connections }:
  { capabilities: CapabilityRow[]; connections: ConnectionRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <>
      <ul style={{ listStyle: "none", padding: 0, margin: 0,
        display: "grid", gap: "var(--space-3)" }}>
        {capabilities.map((c) => {
          const busy = isPending && busyKey === c.key;
          return (
            <li key={c.key}>
              <Card style={{ borderLeft: c.connected
                ? "2px solid var(--ok)" : "2px solid var(--border-strong)" }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <CardTitle>{c.label}</CardTitle>
                    <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
                      maxWidth: "58ch" }}>
                      {c.detail}
                    </p>
                  </div>
                  {/* Text, not just a dot: the state has to survive a greyscale screen. */}
                  <Badge tone={c.connected ? "ok" : "neutral"}>
                    {c.connected ? "connected" : "not connected"}
                  </Badge>
                </div>

                {LIMITS[c.key] && (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                    flexWrap: "wrap", marginTop: "var(--space-3)" }}>
                    <span aria-hidden style={{ color: "var(--faint)",
                      fontSize: "var(--text-sm)" }}>✕</span>
                    <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                      {LIMITS[c.key]}
                    </span>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap",
                  marginTop: "var(--space-4)", paddingTop: "var(--space-3)",
                  borderTop: "1px solid var(--border)" }}>
                  <span className="mono" title="The exact scope Google is asked for"
                    style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
                      wordBreak: "break-all" }}>
                    {c.scopes.join(" · ")}
                  </span>
                  <button disabled={isPending} aria-busy={busy}
                    onClick={() => run(c.key, () => startConnect(c.key))}
                    style={{ ...buttonStyle(c.connected ? "ghost" : "secondary", isPending),
                      minWidth: 104, justifyContent: "center", flexShrink: 0 }}>
                    {busy ? "Opening…" : c.connected ? "Reconnect" : "Connect"}
                  </button>
                </div>
                {c.key === "drive_templates" && c.connected && <TemplatePicker disabled={isPending} />}
              </Card>
            </li>
          );
        })}
      </ul>

      {connections.length > 0 && (
        <section style={{ marginTop: "var(--space-7)" }}>
          <SectionHeading>Connected accounts</SectionHeading>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {connections.map((r) => {
              const busy = isPending && busyKey === r.id;
              return (
                <li key={r.id} style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap",
                  padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.account_email}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
                      marginTop: "var(--space-1)" }}>
                      <Badge tone={STATE_TONE[r.state] ?? "neutral"}>{r.state}</Badge>
                      <span className="mono" style={{ color: "var(--faint)",
                        fontSize: "var(--text-xs)" }}>
                        {r.scopes.length} scope{r.scopes.length === 1 ? "" : "s"} granted
                      </span>
                    </span>
                  </span>
                  {r.state === "active" && (
                    <button disabled={isPending} aria-busy={busy}
                      onClick={() => run(r.id, () => disconnectGoogle(r.id))}
                      style={{ ...buttonStyle("ghost", isPending), minWidth: 108,
                        justifyContent: "center", flexShrink: 0 }}>
                      {busy ? "Revoking…" : "Disconnect"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-3)", maxWidth: "62ch" }}>
            Disconnecting revokes access immediately. The record that the account was once
            connected stays in the audit log — it is never deleted.
          </p>
        </section>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-4)" }}>
          That did not work.{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>{error}</span>
        </p>
      )}
    </>
  );
}
