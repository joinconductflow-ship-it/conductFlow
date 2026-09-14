"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startConnect, disconnectGoogle } from "@/app/actions/connect";
import { scanGmailNow } from "@/app/actions/gmail-watch";
import { TemplatePicker } from "@/components/settings/TemplatePicker";
import { Card, CardTitle, Badge, buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";
import { HEALTH_LABEL, providerHealth, type IntegrationHealth } from "@/lib/integrations/health";

interface CapabilityRow {
  key: string; label: string; detail: string;
  scopes: readonly string[]; connected: boolean;
}
interface ConnectionRow {
  id: string; account_email: string; scopes: string[]; state: string; created_at: string;
  health: IntegrationHealth;
}

export function ConnectionList({ capabilities, connections }:
  { capabilities: CapabilityRow[]; connections: ConnectionRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [syncHealth, setSyncHealth] = useState<{ basedOn: string; health: IntegrationHealth } | null>(null);
  const signature = JSON.stringify(connections);
  const health = syncHealth?.basedOn === signature ? syncHealth.health : providerHealth(connections);
  const canSync = health === "connected" && capabilities.some((c) => c.key === "gmail_watch" && c.connected);
  // Incremental OAuth retains existing grants without bundling new permissions.
  const reconnectKey = capabilities.find((c) => connections.some((r) => c.scopes.every((s) => r.scopes.includes(s))))?.key ?? "gmail_watch";

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (cause) {
        if (key === "sync") setSyncHealth({ basedOn: signature, health: "connection_issue" });
        setError(presentError(cause, { fallback: "Couldn't update Google Workspace right now. Try again." }));
      }
      finally { setBusyKey(null); }
    });
  }

  return (
    <Card style={{ borderLeft: `2px solid var(--${health === "connected" ? "ok" : health === "not_connected" ? "border-strong" : "warn"})` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <CardTitle>Google Workspace</CardTitle>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: `var(--${health === "connected" ? "ok" : health === "not_connected" ? "border-strong" : "warn"})` }} />
          <Badge tone={health === "connected" ? "ok" : health === "not_connected" ? "neutral" : "warn"}>{HEALTH_LABEL[health]}</Badge>
        </span>
      </div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
        {health === "connected" ? `Connected as ${connections.map((r) => r.account_email).join(" · ")}`
          : health === "needs_reconnect" ? "Reconnect Google Workspace to use Gmail, Calendar, and Drive."
          : health === "connection_issue" ? "Couldn't verify Google Workspace right now. Try again."
          : "One Google connection for Gmail, Calendar, and Drive. Permissions are granted as you enable each capability."}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-4) 0", display: "grid", gap: "var(--space-2)" }}>
        {[
          { name: "Gmail", keys: ["gmail_watch", "gmail_drafts"], detail: "Read known-client mail and create drafts. Never sends email." },
          { name: "Calendar", keys: ["calendar_context"], detail: "Check availability and create approved events. Never adds guests." },
          { name: "Drive", keys: ["drive_templates"], detail: "Create approved private Docs. Never auto-shares files." },
        ].map((provider) => {
          const enabled = capabilities.filter((c) => provider.keys.includes(c.key) && c.connected);
          return <li key={provider.name} style={{ padding: "var(--space-2) 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <span>{provider.name}</span>
              <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                {health === "needs_reconnect" ? "Reconnect required" : health === "connection_issue" ? "Unavailable right now" : enabled.length ? "Enabled" : "Not enabled"}
              </span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>{provider.detail}</p>
          </li>;
        })}
      </ul>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
        {canSync && <button disabled={isPending} aria-busy={isPending && busyKey === "sync"}
          style={buttonStyle("secondary", isPending)} onClick={() => run("sync", async () => {
            const result = await scanGmailNow();
            if (result.reconnectRequired) {
              setSyncHealth({ basedOn: signature, health: "needs_reconnect" });
              setError("Reconnect Google Workspace before syncing Gmail.");
            } else if (result.errors) {
              setSyncHealth({ basedOn: signature, health: "connection_issue" });
              setError("Couldn't finish syncing Gmail. Try again.");
            } else setNote(result.connectionsScanned ? `Gmail sync complete. ${result.ingested} new conversations.` : "Gmail sync is not enabled yet.");
          })}>{busyKey === "sync" && isPending ? "Syncing…" : "Sync now"}</button>}
        <button disabled={isPending} style={buttonStyle("secondary", isPending)}
          onClick={() => run("connect", () => startConnect(reconnectKey))}>
          {busyKey === "connect" && isPending ? "Opening…" : health === "needs_reconnect" ? "Reconnect Google Workspace" : connections.length ? "Reconnect Google" : "Connect Google Workspace"}
        </button>
        {health === "connection_issue" && <button disabled={isPending} style={buttonStyle("ghost", isPending)} onClick={() => { setSyncHealth(null); router.refresh(); }}>Check again</button>}
        {connections.filter((r) => r.state !== "revoked").map((r) => <button key={r.id} disabled={isPending}
          style={buttonStyle("ghost", isPending)} onClick={() => run(r.id, () => disconnectGoogle(r.id))}>
          {busyKey === r.id && isPending ? "Disconnecting…" : "Disconnect"}
        </button>)}
      </div>
      {canSync && <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>Sync now checks Gmail for new conversations. Calendar and Drive run only through approved actions.</p>}
      <details style={{ marginTop: "var(--space-4)" }}>
        <summary style={{ cursor: "pointer" }}>Manage capabilities</summary>
        {capabilities.map((c) => <div key={c.key} style={{ padding: "var(--space-3) 0", borderTop: "1px solid var(--border)" }}>
          <p>{c.label}</p>
          <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{c.detail}</p>
          <button disabled={isPending} style={{ ...buttonStyle("ghost", isPending), marginTop: "var(--space-2)" }}
            onClick={() => run(c.key, () => startConnect(c.key))}>
            {busyKey === c.key && isPending ? "Opening…" : c.connected ? "Manage permission" : "Enable capability"}
          </button>
          {c.key === "drive_templates" && c.connected && health === "connected" && <TemplatePicker disabled={isPending} />}
        </div>)}
      </details>
      {error && <p role="alert" className="cf-empty-state" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>{error}</p>}
      {note && <p role="status" className="cf-empty-state" style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>{note}</p>}
    </Card>
  );
}
