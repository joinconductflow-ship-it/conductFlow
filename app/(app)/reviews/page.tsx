import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { ReviewRequestList, type ReviewRequestListProps } from "@/components/reviews/ReviewRequestList";
import { ReceivedReviewPanel, type ReceivedReviewPanelProps } from "@/components/reviews/ReceivedReviewPanel";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const orgId = await getCurrentOrgId();
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Reviews & referrals" />
      <EmptyState
        title="Sign in to see review requests"
        body="Drafted automatically after a task is delivered or an invoice is paid."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [draftResult, reviewResult] = await Promise.all([
    db.from("client_message_draft").select("id,client_id,subject,body")
      .eq("org_id", orgId).eq("kind", "review_request").is("provider_draft_id", null)
      .order("created_at", { ascending: false }),
    db.from("received_review").select("*").eq("org_id", orgId)
      .order("created_at", { ascending: false }),
  ]);
  const { data: drafts, error } = draftResult;
  if (error) throw error;
  if (reviewResult.error) throw reviewResult.error;

  const clientIds = [...new Set((drafts ?? []).map((d) => d.client_id as string))];
  const { data: clients } = clientIds.length > 0
    ? await db.from("client_contact").select("id,name").in("id", clientIds)
    : { data: [] as { id: string; name: string }[] };
  const clientNames = Object.fromEntries((clients ?? []).map((c) => [c.id, c.name as string]));

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Reviews & referrals"
          lede="Drafted automatically after a task is delivered or an invoice is paid — and paste in reviews you receive to get a reply drafted." />
        <ReviewRequestList
          drafts={(drafts ?? []) as ReviewRequestListProps["drafts"]}
          clientNames={clientNames}
        />
        <ReceivedReviewPanel reviews={(reviewResult.data ?? []) as ReceivedReviewPanelProps["reviews"]} />
      </div>
    </main>
  );
}
