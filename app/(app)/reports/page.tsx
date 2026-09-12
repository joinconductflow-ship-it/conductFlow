import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { getUtilizationSummary } from "@/lib/reports/utilization";
import { UtilizationPanel } from "@/components/reports/UtilizationPanel";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const orgId = await getCurrentOrgId("/reports");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Reports" />
      <EmptyState
        title="Sign in to view reports"
        body="Review client utilization and revenue billed to date."
        action={<Link href="/onboarding" className="cf-btn" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  // An incomplete financial rollup must not display missing reads as zero revenue.
  const result = await readPageData("/reports: utilization (time_entry, invoice, client_contact, billing_rate)",
    () => getUtilizationSummary(db, { orgId }));
  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Reports" lede="Review client utilization and billed and unbilled revenue." />
        {result.unavailable ? <Unavailable section="Client utilization is" /> : <UtilizationPanel data={result.data ?? []} />}
      </div>
    </main>
  );
}
