import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery } from "@/lib/db/page-read";
import { LeadInbox, type LeadInboxProps } from "@/components/leads/LeadInbox";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const orgId = await getCurrentOrgId("/leads");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Leads" />
      <EmptyState
        title="Sign in to triage inquiries"
        body="Paste a new inquiry to extract what they need and draft a reply."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [prospects, drafts] = await Promise.all([
    readPageQuery("/leads: prospect", () => db.from("prospect")
      .select("id,name,email,service_interest,urgency,status,created_at")
      .eq("org_id", orgId).order("created_at", { ascending: false })),
    readPageQuery("/leads: prospect_message_draft lead_reply", () => db.from("prospect_message_draft").select("id,prospect_id,subject,body")
      .eq("org_id", orgId).eq("kind", "lead_reply").is("provider_draft_id", null)
      .order("created_at", { ascending: false })),
  ]);

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Leads"
          lede="Paste a new inquiry — from email, a web form, a DM, anywhere — to extract what they need and draft the reply." />
        <LeadInbox
          unavailable={{ prospects: prospects.unavailable, drafts: drafts.unavailable }}
          prospects={(prospects.data ?? []) as LeadInboxProps["prospects"]}
          drafts={(drafts.data ?? []) as LeadInboxProps["drafts"]}
        />
      </div>
    </main>
  );
}
