import Link from "next/link";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { getCurrentOrgId, listCommitments } from "@/lib/db/queries";
import { PageHeader, EmptyState, buttonStyle, pageStyle } from "@/components/ui/primitives";
import { ApprovalCopilotSidebar } from "@/components/copilot/ApprovalCopilotSidebar";

export default async function CopilotPage() {
  const orgId = await getCurrentOrgId("/copilot");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Approval copilot" />
      <EmptyState
        title="Sign in to use the copilot"
        body="The copilot reads your commitment queue and proposes the same actions you'd approve by hand."
        action={<Link href="/onboarding" className="cf-btn" style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const commitments = await readPageData("/copilot: commitment", () => listCommitments(orgId));
  const open = (commitments.data ?? []).filter((c) => c.status === "proposed");

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Approval copilot"
        lede="Ask for what you want in plain English. The copilot proposes the exact Calendar event, Drive doc, or draft — nothing is created until you approve it here."
      />
      {commitments.unavailable && <Unavailable section="The commitment queue is" />}
      <section style={{ marginTop: "var(--space-4)" }}>
        <h2 style={{ fontSize: "var(--text-sm)", color: "var(--faint)", fontWeight: 600 }}>
          AWAITING REVIEW ({open.length})
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-2) 0 0", display: "grid", gap: "var(--space-2)" }}>
          {open.map((commitment) => (
            <li key={commitment.id} style={{ padding: "var(--space-3)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", background: "var(--surface)" }}>
              <strong>{commitment.text}</strong>
              <div style={{ color: "var(--faint)", fontSize: "var(--text-xs)", marginTop: 4 }}>
                {commitment.owner ?? "Unowned"} · due {commitment.deadline ?? "no date"}
              </div>
            </li>
          ))}
          {open.length === 0 && <li style={{ color: "var(--faint)" }}>Nothing awaiting review right now.</li>}
        </ul>
      </section>
      <ApprovalCopilotSidebar />
    </main>
  );
}
