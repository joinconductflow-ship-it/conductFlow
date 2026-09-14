import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SlackConnections } from "@/components/settings/SlackConnections";
import { ConnectionList } from "@/components/settings/ConnectionList";
import { CAPABILITIES } from "@/lib/google/scopes";
import { type IntegrationHealth } from "@/lib/integrations/health";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/settings/TemplatePicker", () => ({ TemplatePicker: () => null }));

const account = { id: "connection", account_email: "qa@example.test", state: "active" };
function slack(health: IntegrationHealth) {
  return renderToStaticMarkup(createElement(SlackConnections, { orgId: "org",
    connections: [{ ...account, health }], clients: [{ id: "client", name: "QA client" }],
    mappings: [{ id: "mapping", connected_data_source_id: account.id, channel_id: "C1",
      channel_name: "client-work", client_contact_id: "client", last_scanned_at: null }],
  }));
}
function google(health: IntegrationHealth, watch = true) {
  const capabilities = Object.entries(CAPABILITIES).map(([key, c]) => ({ key, ...c, connected: key !== "gmail_watch" || watch }));
  return renderToStaticMarkup(createElement(ConnectionList, { capabilities,
    connections: [{ ...account, health, scopes: capabilities.flatMap((c) => [...c.scopes]), created_at: "2026-09-13" }],
  }));
}

describe("Settings provider health presentation", () => {
  it("healthy Slack keeps channel discovery, mapping and reconnect actions", () => {
    const html = slack("connected");
    expect(html).toContain("Connected");
    expect(html).toContain("Reload channels");
    expect(html).toContain("Add mapping");
  });

  it("invalid Slack credentials show reconnect instead of Reload channels and preserve mappings", () => {
    const html = slack("needs_reconnect");
    expect(html).toContain("Needs reconnect");
    expect(html).toContain("Slack needs to be reconnected before ConductFlow can read channels.");
    expect(html).toContain('href="/auth/slack/connect"');
    expect(html).toContain("Reconnect Slack");
    expect(html).not.toContain("Reload channels");
    expect(html).toContain("#client-work");
    expect(html).not.toMatch(/decrypt|DATA_SOURCE_KEK|Server Components|digest|invalid_auth/i);
  });

  it("transient Slack state offers channel retry, not credential-only recovery", () => {
    const html = slack("connection_issue");
    expect(html).toContain("Connection issue");
    expect(html).toContain("Reload channels");
    expect(html).not.toContain("Slack needs to be reconnected before");
  });

  it("fresh reconnect renders Connected again", () => {
    expect(slack("needs_reconnect")).toContain("Needs reconnect");
    expect(slack("connected")).not.toContain("Needs reconnect");
  });

  it("Google is one Workspace card with three capabilities and Gmail-only sync", () => {
    const html = google("connected");
    expect(html.match(/Google Workspace<\//g)).toHaveLength(1);
    expect(html).toContain("Connected as qa@example.test");
    for (const label of ["Gmail", "Calendar", "Drive", "Sync now", "Disconnect", "Manage capabilities"]) expect(html).toContain(label);
    expect(html).toContain("Sync now checks Gmail for new conversations.");
    expect(html).not.toContain("Connected accounts");
    expect(google("connected", false)).not.toContain("Sync now");
  });

  it("Google credential errors are safe and disable sync", () => {
    const html = google("needs_reconnect");
    expect(html).toContain("Reconnect Google Workspace");
    expect(html).not.toContain("Sync now");
    expect(html).not.toContain("Connected as");
    expect(html).not.toMatch(/decrypt|DATA_SOURCE_KEK|Server Components|digest/i);
  });
});
