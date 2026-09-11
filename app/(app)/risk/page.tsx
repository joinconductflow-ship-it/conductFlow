import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { PaymentRiskPanel, type PaymentRiskPanelProps } from "@/components/risk/PaymentRiskPanel";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function PaymentRiskPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Payment Risk" />
      <EmptyState title="Sign in to see payment risk"
        body="Correlate delivery, document, scope, and invoice signals before payment slips."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>} />
    </main>
  );

  const db = await getServerClient();
  const { data: flags, error } = await db.from("payment_risk_flag")
    .select("id,client_id,invoice_id,signal,evidence,related_draft_id,created_at")
    .eq("org_id", orgId).eq("status", "open").order("created_at", { ascending: false });
  if (error) throw error;

  const clientIds = [...new Set((flags ?? []).map((flag) => flag.client_id as string))];
  const draftIds = [...new Set((flags ?? []).flatMap((flag) =>
    flag.related_draft_id ? [flag.related_draft_id as string] : []))];
  const [clientResult, draftResult] = await Promise.all([
    clientIds.length > 0
      ? db.from("client_contact").select("id,name").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    draftIds.length > 0
      ? db.from("client_message_draft").select("id,subject,body").in("id", draftIds)
      : Promise.resolve({ data: [] as { id: string; subject: string | null; body: string }[], error: null }),
  ]);
  if (clientResult.error) throw clientResult.error;
  if (draftResult.error) throw draftResult.error;
  const clientNames = Object.fromEntries((clientResult.data ?? []).map((client) =>
    [client.id, client.name as string]));
  const relatedDrafts = Object.fromEntries((draftResult.data ?? []).map((draft) =>
    [draft.id, { subject: draft.subject as string | null, body: draft.body as string }]));

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Payment Risk"
          lede="Signals from across your other work, correlated against open invoices — catch a payment problem before the invoice is overdue." />
        <PaymentRiskPanel flags={(flags ?? []) as PaymentRiskPanelProps["flags"]}
          clientNames={clientNames} relatedDrafts={relatedDrafts} />
      </div>
    </main>
  );
}
