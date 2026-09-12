import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { ReviewRequestList, type ReviewRequestListProps } from "@/components/reviews/ReviewRequestList";
import { ReceivedReviewPanel, type ReceivedReviewPanelProps } from "@/components/reviews/ReceivedReviewPanel";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const orgId = await getCurrentOrgId("/reviews");
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
    readPageQuery("/reviews: client_message_draft review_request", () => db.from("client_message_draft").select("id,client_id,subject,body")
      .eq("org_id", orgId).eq("kind", "review_request").is("provider_draft_id", null)
      .order("created_at", { ascending: false })),
    readPageQuery("/reviews: received_review", () => db.from("received_review").select("*").eq("org_id", orgId)
      .order("created_at", { ascending: false })),
  ]);
  const drafts = draftResult.data ?? [];

  const clientIds = [...new Set((drafts ?? []).map((d) => d.client_id as string))];
  const clientResult = clientIds.length > 0
    ? await readPageQuery("/reviews: client_contact names", () => db.from("client_contact")
      .select("id,name").eq("org_id", orgId).in("id", clientIds))
    : { data: [] as { id: string; name: string }[], unavailable: false };
  const clients = clientResult.data;
  const clientNames = Object.fromEntries((clients ?? []).map((c) => [c.id, c.name as string]));

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Reviews & referrals"
          lede="Drafted automatically after a task is delivered or an invoice is paid — and paste in reviews you receive to get a reply drafted." />
        {clientResult.unavailable && <Unavailable section="Client names are" />}
        {draftResult.unavailable ? <Unavailable section="Review requests are" /> : <ReviewRequestList
          drafts={(drafts ?? []) as ReviewRequestListProps["drafts"]}
          clientNames={clientNames}
        />}
        <ReceivedReviewPanel reviews={(reviewResult.data ?? []) as ReceivedReviewPanelProps["reviews"]}
          unavailable={reviewResult.unavailable} />
      </div>
    </main>
  );
}
