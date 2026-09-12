import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery } from "@/lib/db/page-read";
import { BillingPanel, type BillingPanelProps } from "@/components/billing/BillingPanel";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function BillingPanelPage() {
  const orgId = await getCurrentOrgId("/billing");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Billing" />
      <EmptyState
        title="Sign in to manage billing"
        body="Log client time, draft invoices, and review collections reminders."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [clients, entries, invoices, drafts] = await Promise.all([
    readPageQuery("/billing: client_contact", () => db.from("client_contact").select("id,name").eq("org_id", orgId).order("name")),
    readPageQuery("/billing: time_entry uninvoiced", () => db.from("time_entry").select("id,client_id,minutes,note,created_at")
      .eq("org_id", orgId).eq("invoiced", false).order("created_at")),
    readPageQuery("/billing: invoice", () => db.from("invoice").select("id,client_id,status,total_cents,due_date")
      .eq("org_id", orgId).order("created_at", { ascending: false })),
    readPageQuery("/billing: client_message_draft billing", () => db.from("client_message_draft").select("id,client_id,kind,subject,body")
      .eq("org_id", orgId).in("kind", ["invoice", "collections_reminder"])
      .is("provider_draft_id", null).order("created_at")),
  ]);

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Billing" lede="Log client time, draft invoices, and review collections reminders." />
        <BillingPanel
          unavailable={{ clients: clients.unavailable, entries: entries.unavailable,
            invoices: invoices.unavailable, drafts: drafts.unavailable }}
          clients={(clients.data ?? []) as BillingPanelProps["clients"]}
          entries={(entries.data ?? []) as BillingPanelProps["entries"]}
          invoices={(invoices.data ?? []) as BillingPanelProps["invoices"]}
          drafts={(drafts.data ?? []) as BillingPanelProps["drafts"]}
        />
      </div>
    </main>
  );
}
