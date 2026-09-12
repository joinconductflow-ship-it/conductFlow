import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery } from "@/lib/db/page-read";
import { RetainerList, type RetainerListProps } from "@/components/retainers/RetainerList";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function RetainerListPage() {
  const orgId = await getCurrentOrgId("/retainers");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Retainers" />
      <EmptyState
        title="Sign in to manage retainers"
        body="Track package balances, log usage, and review renewal drafts."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [clients, retainers, drafts] = await Promise.all([
    readPageQuery("/retainers: client_contact", () => db.from("client_contact").select("id,name").eq("org_id", orgId).order("name")),
    readPageQuery("/retainers: retainer", () => db.from("retainer").select("id,org_id,client_id,label,unit,total_units,used_units,low_balance_threshold,status,renewal_offered_at")
      .eq("org_id", orgId).order("created_at", { ascending: false })),
    readPageQuery("/retainers: client_message_draft retainer_renewal", () => db.from("client_message_draft").select("id,source_id,subject,body")
      .eq("org_id", orgId).eq("kind", "retainer_renewal").is("provider_draft_id", null).order("created_at")),
  ]);

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Retainers" lede="Track package balances, log usage, and review renewal drafts." />
        <RetainerList
          unavailable={{ clients: clients.unavailable, retainers: retainers.unavailable, drafts: drafts.unavailable }}
          clients={(clients.data ?? []) as RetainerListProps["clients"]}
          retainers={(retainers.data ?? []) as RetainerListProps["retainers"]}
          drafts={(drafts.data ?? []) as RetainerListProps["drafts"]}
        />
      </div>
    </main>
  );
}
