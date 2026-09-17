import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { DesktopTokens, type TokenRow } from "@/components/settings/DesktopTokens";
import {
  PageHeader, BackLink, EmptyState, Card, CardTitle, buttonStyle, pageStyle, columnStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Deliberately its own route rather than a section of /settings: member management on
 * that page is being rewritten on another branch, and two agents editing one file is
 * exactly what the coordination rules exist to prevent.
 */
export default async function DesktopSettingsPage() {
  const orgId = await getCurrentOrgId("/settings/desktop");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Desktop app" />
      <EmptyState
        title="Sign in to set up the desktop app"
        body="Desktop tokens belong to a workspace, so there is nothing to show until you are in one."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>
  );

  const db = await getServerClient();
  // A read failure is not an empty list — saying "no tokens" when the database is
  // unreachable would invite someone to mint a duplicate they do not need. readPageQuery
  // is the house helper for that distinction and survives a rejected promise too.
  const tokens = await readPageQuery("/settings/desktop: desktop_token_public", () =>
    db.from("desktop_token_public")
      .select("id, label, created_at, last_used_at, revoked_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }));

  return (
    <main style={pageStyle}>
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Desktop app"
        lede="Capture a conversation from anywhere on your Mac with a keyboard shortcut, or from the Chrome extension while you're in a call. The same token below works for both."
      />

      <div style={columnStyle}>
        <Card>
          <CardTitle>What it can do</CardTitle>
          <p style={{ fontSize: 13, lineHeight: 1.65 }}>
            The desktop app sends text you have copied, and the Chrome extension sends the
            meeting transcript it captured, to this workspace, where either runs the same
            extraction the web app runs. Commitments and drafts land in your queue as
            proposals. Neither can approve anything, and neither can send anything — approval
            still happens here, by you.
          </p>
        </Card>

        {tokens.unavailable
          ? <Unavailable section="Desktop tokens" />
          : <DesktopTokens tokens={(tokens.data ?? []) as TokenRow[]} />}
      </div>
    </main>
  );
}
