"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addTeamsChannelMapping, removeTeamsChannelMapping, listMicrosoftTeamsChannels, type TeamsChannelMapping,
} from "@/app/actions/microsoft-teams";
import { MICROSOFT_CAPABILITIES, MICROSOFT_TEAMS_SCOPES } from "@/lib/microsoft/scopes";
import { presentError } from "@/lib/errors/presentation";
import { failureHealth, HEALTH_LABEL, providerHealth, microsoftHealthMessage, type IntegrationHealth } from "@/lib/integrations/health";
import { Badge, Card, CardTitle, buttonStyle, fieldStyle, labelStyle } from "@/components/ui/primitives";

interface Props {
  orgId: string;
  connections: { id: string; account_email: string; state: string; health: IntegrationHealth; scopes: string[]; updated_at?: string }[];
  clients: { id: string; name: string }[];
  mappings: TeamsChannelMapping[];
}

export function MicrosoftConnections({ orgId, connections, clients, mappings }: Props) {
  const router = useRouter();
  const [channels, setChannels] = useState<Awaited<ReturnType<typeof listMicrosoftTeamsChannels>>["channels"]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [teamsDiscovery, setTeamsDiscovery] = useState<{ basedOn: string; health: IntegrationHealth } | null>(null);
  const [pending, startTransition] = useTransition();
  const activeConnections = connections.filter((connection) => connection.state === "active" && connection.health !== "needs_reconnect");
  const connectionKey = activeConnections.map((connection) => connection.id).join(",");
  const signature = JSON.stringify(connections);
  // The card's own badge reflects only whether the OAuth grant itself is valid — not whether
  // every optional scope on it was granted. Mail can work fine on a connection that shows
  // "connected" here even when Teams is still waiting on admin approval below.
  const health = providerHealth(connections);
  const usable = health === "connected" || health === "connection_issue";
  const grantedScopes = new Set(activeConnections.flatMap((connection) => connection.scopes));
  const mailGranted = grantedScopes.has("Mail.Read");
  const teamsGranted = MICROSOFT_TEAMS_SCOPES.every((scope) => grantedScopes.has(scope));
  const teamsHealth = teamsDiscovery?.basedOn === signature ? teamsDiscovery.health : (teamsGranted ? "connected" : "needs_reconnect");

  useEffect(() => {
    let cancelled = false;
    // Skip the Graph call entirely when the stored grant already tells us Teams scopes were
    // never issued — calling anyway would just log the same 403 on every settings page view.
    if (!connectionKey || !teamsGranted) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    listMicrosoftTeamsChannels(orgId).then((result) => {
      if (!cancelled) {
        setChannels(result.channels);
        setTeamsDiscovery({ basedOn: signature, health: result.health });
        setError(microsoftHealthMessage(result.health));
      }
    }).catch((cause) => {
      if (!cancelled) {
        setChannels([]);
        setTeamsDiscovery({ basedOn: signature, health: failureHealth(cause) });
        setError(presentError(cause, {
          fallback: "Couldn't load Teams channels right now. Try reloading channels.",
          authentication: "Please sign in again to load Teams channels.",
          reconnect: "Microsoft needs to be reconnected before ConductFlow can read channels.",
        }));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId, connectionKey, teamsGranted, signature, reload]);

  function run(action: () => Promise<void>, success: string) {
    setError(null); setNote(null);
    startTransition(async () => {
      try { await action(); setNote(success); router.refresh(); }
      catch (cause) { setError(presentError(cause, {
        fallback: "Couldn't save the Teams mapping. Try again.",
        authentication: "Please sign in again to save the Teams mapping.",
        reconnect: "Microsoft needs to be reconnected before ConductFlow can save this mapping.",
      })); router.refresh(); }
    });
  }

  return (
    <Card style={{ borderLeft: health === "connected" ? "2px solid var(--ok)" : connections.length ? "2px solid var(--warn)" : "2px solid var(--border-strong)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <CardTitle>{MICROSOFT_CAPABILITIES.microsoft_365.label}</CardTitle>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: `var(--${health === "connected" ? "ok" : health === "not_connected" ? "border-strong" : "warn"})` }} />
          <Badge tone={health === "connected" ? "ok" : health === "not_connected" ? "neutral" : "warn"}>{HEALTH_LABEL[health]}</Badge>
        </span>
      </div>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>{MICROSOFT_CAPABILITIES.microsoft_365.detail}</p>
      {connections.length > 0 && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>Account: {connections.map((connection) => connection.account_email).join(" · ")}</p>}
      {health === "not_connected" ? (
        <a href="/auth/microsoft/connect" className="cf-btn" style={{ ...buttonStyle("secondary"), marginTop: "var(--space-4)" }}>Connect Microsoft</a>
      ) : !usable ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <p style={{ color: "var(--muted)" }}>Microsoft needs to be reconnected before ConductFlow can read your mail or channels.</p>
          <a href="/auth/microsoft/connect" className="cf-btn" style={{ ...buttonStyle("secondary"), marginTop: "var(--space-3)" }}>Reconnect Microsoft</a>
        </div>
      ) : <>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>
          {mailGranted ? "Outlook mail: reading your inbox for commitments." : "Outlook mail: not granted on this connection."}
        </p>
        {!teamsGranted ? (
          <div style={{ marginTop: "var(--space-4)", padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <p style={{ color: "var(--muted)" }}>
              Teams needs your Microsoft admin to approve extra permissions for your whole
              organization — this can&rsquo;t be granted by clicking Connect alone. Send this
              to whoever holds Global Admin at your company, or click it yourself if that&rsquo;s
              you.
            </p>
            <a href="/auth/microsoft/admin-consent" className="cf-btn"
              style={{ ...buttonStyle("secondary"), marginTop: "var(--space-3)" }}>
              Ask your Microsoft admin to approve Teams access
            </a>
          </div>
        ) : <>
          <form onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const channel = channels.find((item) => `${item.connectedDataSourceId}:${item.id}` === data.get("channel"));
            if (!channel) return;
            run(() => addTeamsChannelMapping(orgId, channel.connectedDataSourceId, channel.id, channel.name,
              String(data.get("client"))), "Channel mapping saved.");
          }}>
            <label style={labelStyle}>Teams channel
              <select name="channel" required defaultValue="" disabled={loading || pending} style={fieldStyle}>
                <option value="" disabled>{loading ? "Loading channels…" : "Choose a channel"}</option>
                {channels.map((channel) => <option key={`${channel.connectedDataSourceId}:${channel.id}`}
                  value={`${channel.connectedDataSourceId}:${channel.id}`}>
                  {channel.name}
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
            {!loading && !channels.length && !error && teamsHealth === "connected" && <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>No channels available. Check your Teams membership, then reload.</p>}
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
                onClick={() => run(() => removeTeamsChannelMapping(mapping.id), "Channel mapping removed.")}>Remove</button>
            </li>)}
          </ul>
          {!mappings.length && <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>No channels mapped yet.</p>}
          {(error || teamsHealth === "connection_issue") && <p role="alert" className="cf-empty-state" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>{error ?? microsoftHealthMessage(teamsHealth)}</p>}
        </>}
        <a href="/auth/microsoft/connect" className="cf-btn" style={{ ...buttonStyle("ghost"), marginTop: "var(--space-4)" }}>Reconnect Microsoft</a>
      </>}
      {note && <p role="status" className="cf-empty-state" style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>{note}</p>}
    </Card>
  );
}
