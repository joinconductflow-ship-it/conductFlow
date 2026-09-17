import Link from "next/link";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import {
  getActionSuggestionsForCommitment,
  getCommitment,
  getDraftForCommitment,
  getTaskForCommitment,
  getTranscriptForCommitment,
} from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { getTaskIntelligence } from "@/lib/tasks/intelligence-query";
import { TaskIntelligencePanel } from "@/components/tasks/TaskIntelligencePanel";
import { DraftSurface } from "@/components/draft/DraftSurface";
import { ApprovalBar } from "@/components/draft/ApprovalBar";
import { GenerateDraftButton } from "@/components/draft/GenerateDraftButton";
import {
  BackLink, Card, CardTitle, EmptyState, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

/** Label above value, value in mono — the panel reads like an instrument, not a sentence. */
function Fact({ label, value, tone }:
  { label: string; value: string; tone?: "danger" | "warn" | "ok" }) {
  return (
    <div>
      <dt className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
        letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </dt>
      <dd className="mono" style={{ margin: "3px 0 0", wordBreak: "break-word",
        color: tone === "danger" ? "var(--danger-text)"
          : tone === "warn" ? "var(--warn)"
            : tone === "ok" ? "var(--ok)" : "var(--text)" }}>
        {value}
      </dd>
    </div>
  );
}

export default async function DraftReview({
  params,
  searchParams,
}: {
  params: Promise<{ commitmentId: string }>;
  searchParams?: Promise<{ taskId?: string | string[] }>;
}) {
  const { commitmentId } = await params;
  const [commitmentResult, draftResult, transcriptResult, actionSuggestionsResult] = await Promise.all([
    readPageData(`/queue/[commitmentId]: commitment ${commitmentId}`, () => getCommitment(commitmentId)),
    readPageData(`/queue/[commitmentId]: deliverable_draft ${commitmentId}`, () => getDraftForCommitment(commitmentId)),
    readPageData(`/queue/[commitmentId]: transcript ${commitmentId}`, () => getTranscriptForCommitment(commitmentId)),
    readPageData(`/queue/[commitmentId]: commitment_action_suggestion ${commitmentId}`,
      () => getActionSuggestionsForCommitment(commitmentId)),
  ]);
  const c = commitmentResult.data;
  const draft = draftResult.data;
  const transcript = transcriptResult.data;
  const actionSuggestions = actionSuggestionsResult.data ?? [];
  const expectsEmailDraft = actionSuggestions.some((action) => action.action_type === "gmail_draft");
  const hasDraftContent = !!draft?.subject?.trim() && !!draft.body?.trim();

  if (commitmentResult.unavailable) return <main style={pageStyle}>
    <BackLink href="/queue">Queue</BackLink>
    <Unavailable section="This commitment is" />
  </main>;

  if (!c) return (
    <main style={pageStyle}>
      <EmptyState
        title="That commitment is not here"
        body="It may have been replaced by a re-extraction, or it belongs to another workspace."
        action={<Link href="/queue" className="cf-btn"
          style={buttonStyle("primary")}>Back to the queue</Link>}
      />
    </main>
  );

  const rawTaskId = (await searchParams)?.taskId;
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId;
  const taskResult = taskId
    ? await readPageData(`/queue/[commitmentId]: task subject ${taskId}`, () => getTaskForCommitment(taskId, c.id))
    : { data: null, unavailable: false };
  const intelligenceSubject = taskResult.data && taskResult.data.org_id === c.org_id
    ? { type: "task" as const, id: taskResult.data.id }
    : { type: "commitment" as const, id: c.id };
  const intelligenceResult = await readPageData(
    `/queue/[commitmentId]: task intelligence ${intelligenceSubject.type}:${intelligenceSubject.id}`,
    async () => getTaskIntelligence(await getServerClient(), { orgId: c.org_id, subject: intelligenceSubject }),
  );

  const overdue = !!c.deadline && new Date(c.deadline) < new Date() && c.status !== "done";
  const flagged = transcript && transcript.injection_flags.length > 0;

  return (
    <main style={pageStyle}>
      <BackLink href="/queue">Queue</BackLink>

      <h1 style={{ margin: 0, fontSize: "var(--text-xl)", maxWidth: "44ch", lineHeight: 1.25,
        letterSpacing: "-0.03em" }}>
        {c.text}
      </h1>

      <div className="commitment-detail-layout" style={{ display: "flex", flexWrap: "wrap",
        gap: "var(--space-6)", alignItems: "flex-start", marginTop: "var(--space-5)" }}>
        <div className="commitment-workflow-column" style={{ flex: "1 1 560px", minWidth: 0 }}>
          <TaskIntelligencePanel
            subjectType={intelligenceSubject.type}
            subjectId={intelligenceSubject.id}
            initial={intelligenceResult.data}
          />

          <section id="actions" aria-labelledby="prepared-work-heading" style={{ marginTop: "var(--space-6)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
              marginBottom: "var(--space-4)", paddingBottom: "var(--space-3)",
              borderBottom: "1px solid var(--border)" }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999,
                background: "var(--accent)", flexShrink: 0 }} />
              <h2 id="prepared-work-heading" style={{ margin: 0, fontSize: "var(--text-md)",
                fontWeight: 650, letterSpacing: "-0.02em" }}>Prepared work</h2>
            </div>

          {flagged && (
            <Card tone="warn" style={{ marginBottom: "var(--space-4)" }}>
              <CardTitle tone="warn" dot>Flagged source</CardTitle>
              <p style={{ color: "var(--muted)", marginTop: "var(--space-2)",
                maxWidth: "68ch", lineHeight: 1.55 }}>
                This transcript contained text that reads like instructions to the assistant. It was
                treated as data and never followed — but read this commitment carefully before
                approving.
              </p>
              <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
                marginTop: "var(--space-3)" }}>
                matched: {transcript.injection_flags.join(" · ")}
              </p>
            </Card>
          )}

          {transcriptResult.unavailable && <Unavailable section="Source review is" />}
            {draftResult.unavailable ? <Unavailable section="The draft is" /> : <div>
              <DraftSurface
                draft={draft}
                provenance={["transcript", "client record"]}
                expectsEmailDraft={expectsEmailDraft}
              />
              <GenerateDraftButton commitmentId={c.id} hasDraft={!!draft} />
            </div>}
          {actionSuggestionsResult.unavailable && <Unavailable section="Detected actions are" />}
          {!draftResult.unavailable && !transcriptResult.unavailable &&
            !actionSuggestionsResult.unavailable && (
              <ApprovalBar
                commitmentId={c.id}
                actions={actionSuggestions}
                hasDraftContent={hasDraftContent}
              />
            )}
          </section>
        </div>

        <aside className="commitment-reference-rail" style={{ flex: "0 1 228px", minWidth: 180,
          borderLeft: "1px solid var(--border)", paddingLeft: "var(--space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)",
            marginBottom: "var(--space-4)" }}>
            <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999,
              background: "var(--border-strong)", flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 650,
              letterSpacing: "-0.02em" }}>Commitment</h2>
          </div>
          <dl style={{ margin: 0, display: "grid", gap: "var(--space-5)" }}>
            <Fact label="Owner" value={c.owner ?? "unassigned"}
              tone={c.owner ? undefined : "warn"} />
            <Fact label="Due" value={c.deadline?.slice(0, 10) ?? "no date"}
              tone={overdue ? "danger" : c.deadline ? undefined : "warn"} />
            <Fact label="Confidence" value={c.confidence}
              tone={c.confidence === "low" ? "warn" : undefined} />
            <Fact label="Status" value={c.status}
              tone={c.status === "done" ? "ok" : c.status === "rejected" ? "danger" : undefined} />
          </dl>
        </aside>
      </div>
    </main>
  );
}
