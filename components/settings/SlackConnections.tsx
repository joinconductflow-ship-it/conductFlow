"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addChannelMapping, removeChannelMapping, listSlackChannels, type ChannelMapping,
} from "@/app/actions/slack-channels";
import { SLACK_CAPABILITIES } from "@/lib/slack/scopes";
import { presentError } from "@/lib/errors/presentation";
import { failureHealth, HEALTH_LABEL, providerHealth, slackHealthMessage, type IntegrationHealth } from "@/lib/integrations/health";
import { Badge, Card, CardTitle, buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";

interface Props {
  orgId: string;
  connections: { id: string; account_email: string; state: string; health: IntegrationHealth; updated_at?: string }[];
  clients: { id: string; name: string }[];
  mappings: ChannelMapping[];
}

export function SlackConnections({ orgId, connections, clients, mappings }: Props) {
  const router = useRouter();
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listSlackChannels>>["channels"]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<{ basedOn: string; health: IntegrationHealth } | null>(null);
  const [pending, startTransition] = useTransition();
  const activeConnections = connections.filter((connection) => connection.state === "active" && connection.health !== "needs_reconnect");
  const connectionKey = activeConnections.map((connection) => connection.id).join(",");
  const signature = JSON.stringify(connections);
  const health = discovery?.basedOn === signature ? discovery.health : providerHealth(connections);
  const usable = health === "connected" || health === "connection_issue";

  useEffect(() => {
    let cancelled = false;
    if (!connectionKey) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    listSlackChannels(orgId).then((result) => {
      if (!cancelled) {
        setChannels(result.channels);
        setDiscovery({ basedOn: signature, health: result.health });
        setError(slackHealthMessage(result.health));
      }
    }).catch((cause) => {
      if (!cancelled) {
        setChannels([]);
        setDiscovery({ basedOn: signature, health: failureHealth(cause) });
        setError(presentError(cause, {
          fallback: "Couldn't load Slack channels right now. Try reloading channels.",
          authentication: "Please sign in again to load Slack channels.",
          reconnect: "Slack needs to be reconnected before ConductFlow can read channels.",
        }));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, connectionKey, signature, reload]);

  function run(action: () => Promise<void>, success: string) {
    setError(null); setNote(null);
    startTransition(async () => {
      try { await action(); setNote(success); router.refresh(); }
      catch (cause) { setError(presentError(cause, {
        fallback: "Couldn't save the Slack mapping. Try again.",
        authentication: "Please sign in again to save the Slack mapping.",
        reconnect: "Slack needs to be reconnected before ConductFlow can save this mapping.",
      })); router.refresh(); }
    });
  }

  return (
    <Card style={{ borderLeft: health === "connected" ? "2px solid var(--ok)" : connections.length ? "2px solid var(--warn)" : "2px solid var(--border-strong)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <CardTitle>{SLACK_CAPABILITIES.slack_watch.label}</CardTitle>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: `var(--${health === "connected" ? "ok" : health === "not_connected" ? "border-strong" : "warn"})` }} />
          <Badge tone={health === "connected" ? "ok" : health === "not_connected" ? "neutral" : "warn"}>{HEALTH_LABEL[health]}</Badge>
        </span>
      </div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>{SLACK_CAPABILITIES.slack_watch.detail}</p>
      {connections.length > 0 && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>Workspace: {connections.map((connection) => connection.account_email).join(" · ")}</p>}
      {health === "not_connected" ? (
        <a href="/auth/slack/connect" className="cf-btn" style={{ ...buttonStyle("secondary"), marginTop: "var(--space-4)" }}>Connect Slack</a>
      ) : !usable ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <p style={{ color: "var(--muted)" }}>Slack needs to be reconnected before ConductFlow can read channels.</p>
          <a href="/auth/slack/connect" className="cf-btn" style={{ ...buttonStyle("secondary"), marginTop: "var(--space-3)" }}>Reconnect Slack</a>
        </div>
      ) : <>
        <form onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const channel = channels.find((item) => `${item.connectedDataSourceId}:${item.id}` === data.get("channel"));
          if (!channel) return;
          run(() => addChannelMapping(orgId, channel.connectedDataSourceId, channel.id, channel.name,
            String(data.get("client"))), "Channel mapping saved.");
        }}>
          <label style={labelStyle}>Slack channel
            <select name="channel" required defaultValue="" disabled={loading || pending} style={fieldStyle}>
              <option value="" disabled>{loading ? "Loading channels…" : "Choose a channel"}</option>
              {channels.map((channel) => <option key={`${channel.connectedDataSourceId}:${channel.id}`}
                value={`${channel.connectedDataSourceId}:${channel.id}`}>
                {activeConnections.length > 1 ? `${channel.teamName} / ` : ""}#{channel.name}
              </option>)}
            </select>
          </label>
          <label style={labelStyle}>Client
            <select name="client" required defaultValue="" disabled={pending} style={fieldStyle}>
              <option value="" disabled>Choose a client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          {!clients.length && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>Add a client before mapping a channel.</p>}
          {!loading && !channels.length && !error && health === "connected" && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>No channels available. Invite the bot to private channels, then reload.</p>}
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
            <button type="submit" disabled={pending || loading || !channels.length || !clients.length}
              style={buttonStyle("secondary", pending || loading || !channels.length || !clients.length)}>
              {pending ? "Saving…" : "Add mapping"}
            </button>
            <button type="button" disabled={pending || loading} onClick={() => setReload((value) => value + 1)}
              style={buttonStyle("ghost", pending || loading)}>Reload channels</button>
            <a href="/auth/slack/connect" className="cf-btn" style={buttonStyle("ghost")}>Reconnect Slack</a>
          </div>
        </form>
      </>}
        <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-5) 0 0" }}>
          {mappings.map((mapping) => <li key={mapping.id} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", padding: "var(--space-3) 0",
            borderTop: "1px solid var(--border)" }}>
            <span>{connections.length > 1 ? `${connections.find((connection) => connection.id === mapping.connected_data_source_id)?.account_email} / ` : ""}
              #{mapping.channel_name} → {clients.find((client) => client.id === mapping.client_contact_id)?.name ?? "Client"}</span>
            <button type="button" disabled={pending} style={buttonStyle("ghost", pending)}
              aria-label={`Remove mapping for ${mapping.channel_name}`}
              onClick={() => run(() => removeChannelMapping(mapping.id), "Channel mapping removed.")}>Remove</button>
          </li>)}
        </ul>
        {!mappings.length && <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>No channels mapped yet.</p>}
      {(error || health === "connection_issue") && <p role="alert" className="cf-empty-state" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>{error ?? slackHealthMessage(health)}</p>}
      {note && <p role="status" className="cf-empty-state" style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>{note}</p>}
    </Card>
  );
}
