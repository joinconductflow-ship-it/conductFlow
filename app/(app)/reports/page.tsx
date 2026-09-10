import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getUtilizationSummary } from "@/lib/reports/utilization";
import { UtilizationPanel } from "@/components/reports/UtilizationPanel";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const orgId = await getCurrentOrgId();
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
  const data = await getUtilizationSummary(db, { orgId });
  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Reports" lede="Review client utilization and billed and unbilled revenue." />
        <UtilizationPanel data={data} />
      </div>
    </main>
  );
}
