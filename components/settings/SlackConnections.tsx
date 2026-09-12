"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addChannelMapping, removeChannelMapping, listSlackChannels, type ChannelMapping,
} from "@/app/actions/slack-channels";
import { SLACK_CAPABILITIES } from "@/lib/slack/scopes";
import { Badge, Card, CardTitle, buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";

interface Props {
  orgId: string;
  connections: { id: string; account_email: string }[];
  clients: { id: string; name: string }[];
  mappings: ChannelMapping[];
}

export function SlackConnections({ orgId, connections, clients, mappings }: Props) {
  const router = useRouter();
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listSlackChannels>>>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const connectionKey = connections.map((connection) => connection.id).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!connectionKey) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    listSlackChannels(orgId).then((items) => {
      if (!cancelled) setChannels(items);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load Slack channels.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, connectionKey, reload]);

  function run(action: () => Promise<void>, success: string) {
    setError(null); setNote(null);
    startTransition(async () => {
      try { await action(); setNote(success); router.refresh(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save Slack mapping."); }
    });
  }

  return (
    <Card style={{ borderLeft: connections.length ? "2px solid var(--ok)" : "2px solid var(--border-strong)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <CardTitle>{SLACK_CAPABILITIES.slack_watch.label}</CardTitle>
        <Badge tone={connections.length ? "ok" : "neutral"}>{connections.length ? "connected" : "not connected"}</Badge>
      </div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>{SLACK_CAPABILITIES.slack_watch.detail}</p>
      {!connections.length ? (
        <a href="/auth/slack/connect" className="cf-btn" style={{ ...buttonStyle("secondary"), marginTop: "var(--space-4)" }}>Connect Slack</a>
      ) : <>
        <p style={{ marginTop: "var(--space-4)" }}>{connections.map((connection) => connection.account_email).join(" · ")}</p>
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
                {connections.length > 1 ? `${channel.teamName} / ` : ""}#{channel.name}
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
          {!loading && !channels.length && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>No channels available. Invite the bot to private channels, then reload.</p>}
          <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
            <button type="submit" disabled={pending || loading || !channels.length || !clients.length}
              style={buttonStyle("secondary", pending || loading || !channels.length || !clients.length)}>
              {pending ? "Saving…" : "Add mapping"}
            </button>
            <button type="button" disabled={pending || loading} onClick={() => setReload((value) => value + 1)}
              style={buttonStyle("ghost", pending || loading)}>Reload channels</button>
          </div>
        </form>
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
      </>}
      {error && <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>{note}</p>}
    </Card>
  );
}
