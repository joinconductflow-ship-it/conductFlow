import Link from "next/link";
import { MicrosoftConnections } from "@/components/settings/MicrosoftConnections";
import { listTeamsChannelMappings } from "@/app/actions/microsoft-teams";
import { storedHealth } from "@/lib/integrations/health";
import { SlackConnections } from "@/components/settings/SlackConnections";
import { listChannelMappings } from "@/app/actions/slack-channels";
import { getCurrentOrgId, listClients } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageData, readPageQuery } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { presentErrorText } from "@/lib/errors/presentation";
import { CAPABILITIES, type Capability } from "@/lib/google/scopes";
import { ConnectionList } from "@/components/settings/ConnectionList";
import { connectionHealth } from "@/lib/integrations/health-server";
import { type IntegrationHealth } from "@/lib/integrations/health";
import {
  PageHeader, Card, CardTitle, EmptyState, SectionHeading, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export interface ConnectionRow {
  id: string; provider: string; account_email: string; scopes: string[];
  state: string; created_at: string; updated_at: string;
}

/** Wider than a form, narrower than the queue: these are cards you read one at a time. */
const column: React.CSSProperties = { maxWidth: 720 };

export default async function SettingsPage({ searchParams }:
  { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { error, connected } = await searchParams;
  const safeError = presentErrorText(error, {
    fallback: "Couldn't complete that connection. Try again.",
    authentication: "Please sign in again before changing connections.",
    provider: "Couldn't complete that connection. Try again, or reconnect it.",
  });
  const orgId = await getCurrentOrgId("/settings");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Settings" />
      <EmptyState
        title="Sign in to manage connections"
        body="Google access is granted one capability at a time, and can be revoked here."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  // The view, not the table: it projects no sealed material, and the table itself is
  // granted to service_role alone.
  const db = await getServerClient();
  const connections = await readPageQuery("/settings: connected_data_source_public", () => db.from("connected_data_source_public")
    .select("id,provider,account_email,scopes,state,created_at,updated_at").eq("org_id", orgId));
  const verifiedHealth = await readPageData<Record<string, IntegrationHealth>>("/settings: credential health", () =>
    connections.unavailable || !connections.data?.length ? Promise.resolve({}) : connectionHealth(orgId));
  const rows = ((connections.data ?? []) as ConnectionRow[]).map((row) => ({ ...row,
    health: verifiedHealth.data?.[row.id] ?? "connection_issue" as const,
  }));
  const googleRows = rows.filter((row) => row.provider === "google");
  const slackRows = rows.filter((row) => row.provider === "slack");
  const [clients, mappings] = await Promise.all([
    readPageData("/settings: clients", () => slackRows.length ? listClients(orgId) : Promise.resolve([])),
    readPageData("/settings: Slack mappings", () => slackRows.length ? listChannelMappings(orgId) : Promise.resolve([])),
  ]);
  // Microsoft discovery verifies live health in its own connection card.
  const microsoftRows = rows.filter((row) => row.provider === "microsoft")
    .map((row) => ({ ...row, health: storedHealth(row) }));
  const [microsoftClients, teamsMappings] = await Promise.all([
    readPageData("/settings: Microsoft clients", () => microsoftRows.length ? listClients(orgId) : Promise.resolve([])),
    readPageData("/settings: Teams mappings", () => microsoftRows.length ? listTeamsChannelMappings(orgId) : Promise.resolve([])),
  ]);
  const granted = new Set(googleRows.filter((r) => r.state === "active").flatMap((r) => r.scopes));

  const capabilities = (Object.keys(CAPABILITIES) as Capability[]).map((key) => ({
    key,
    ...CAPABILITIES[key],
    connected: CAPABILITIES[key].scopes.every((s) => granted.has(s)),
  }));

  return (
    <main style={pageStyle}>
      <div style={column}>
      <PageHeader
        title="Settings"
        lede="Manage Google Workspace and map Slack channels to your clients."
      />

      {connected && (
        <Card tone="ok" style={{ marginBottom: "var(--space-4)" }}>
          <CardTitle tone="ok" dot>Account connected</CardTitle>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
            OAuth completed. Check connection health and enabled capabilities below.
          </p>
        </Card>
      )}
      {safeError && (
        <Card tone="danger" style={{ marginBottom: "var(--space-4)" }}>
          <CardTitle tone="danger" dot>Connection failed</CardTitle>
          <p className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)", wordBreak: "break-word" }}>
            {safeError}
          </p>
        </Card>
      )}

      <SectionHeading>Integrations</SectionHeading>
      {connections.unavailable ? <Unavailable section="Google connections are" /> : <ConnectionList capabilities={capabilities} connections={googleRows} />}

      <div style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading>Slack</SectionHeading>
        {connections.unavailable || clients.unavailable || mappings.unavailable
          ? <Unavailable section="Slack connections are" />
          : <SlackConnections orgId={orgId} connections={slackRows} clients={clients.data ?? []}
            mappings={(mappings.data ?? []).filter((mapping) => slackRows.some((row) => row.id === mapping.connected_data_source_id))} />}
      </div>

      <div style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading>Microsoft</SectionHeading>
        {connections.unavailable || microsoftClients.unavailable || teamsMappings.unavailable
          ? <Unavailable section="Microsoft connections are" />
          : <MicrosoftConnections orgId={orgId} connections={microsoftRows} clients={microsoftClients.data ?? []}
            mappings={(teamsMappings.data ?? []).filter((mapping) => microsoftRows.some((row) => row.id === mapping.connected_data_source_id))} />}
      </div>

      <div style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading>Permissions</SectionHeading>
      </div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <div>
            <CardTitle>Agent blueprint</CardTitle>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "56ch" }}>
              Exactly what the assistant may do on your behalf, what it has to ask you about
              first, and the things it can never do at any setting.
            </p>
          </div>
          <Link href="/settings/blueprint" className="cf-btn" style={buttonStyle("secondary")}>
            Review the blueprint
          </Link>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <div>
            <CardTitle>Desktop app</CardTitle>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "56ch" }}>
              Capture a conversation from anywhere on your Mac with a keyboard shortcut.
              It reads your clipboard when you ask it to, and nothing else.
            </p>
          </div>
          <Link href="/settings/desktop" className="cf-btn" style={buttonStyle("secondary")}>
            Set up the desktop app
          </Link>
        </div>
      </Card>
      </div>
    </main>
  );
}
