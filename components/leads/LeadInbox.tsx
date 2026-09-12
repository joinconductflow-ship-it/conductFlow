"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import { submitInquiry, convertProspect, pushLeadReplyDraft } from "@/app/actions/leads";
import {
  Card, CardTitle, Badge, EmptyState, buttonStyle, fieldStyle, labelStyle, proseStyle,
} from "@/components/ui/primitives";

export interface LeadInboxProps {
  unavailable?: Partial<Record<"prospects" | "drafts", boolean>>;
  prospects: {
    id: string; name: string | null; email: string | null;
    service_interest: string | null; urgency: "low" | "medium" | "high";
    status: "new" | "replied" | "converted" | "archived"; created_at: string;
  }[];
  drafts: { id: string; prospect_id: string; subject: string | null; body: string }[];
}

const URGENCY_TONE = { low: "neutral", medium: "accent", high: "danger" } as const;

export function LeadInbox({ prospects, drafts, unavailable = {} }: LeadInboxProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}

      <Card>
        <CardTitle>Paste a new inquiry</CardTitle>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          run("triage", async () => {
            await submitInquiry(data);
            form.reset();
            setNote("Inquiry triaged. Check the draft reply below.");
          });
        }}>
          <label style={labelStyle}>Inquiry text
            <textarea name="rawInquiry" required rows={5}
              placeholder="Paste the email, form submission, or message as-is."
              style={{ ...fieldStyle, resize: "vertical" }} disabled={isPending} />
          </label>
          <button type="submit" disabled={isPending}
            style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-3)" }}>
            {isPending && busyKey === "triage" ? "Triaging…" : "Triage inquiry"}
          </button>
        </form>
      </Card>

      {unavailable.drafts && <Unavailable section="Pending replies are" />}
      {drafts.length > 0 && (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <CardTitle>Pending replies</CardTitle>
          {drafts.map((draft) => (
            <Card key={draft.id}>
              <p style={{ ...proseStyle, color: "var(--muted)" }}>{draft.subject}</p>
              <p style={{ ...proseStyle, whiteSpace: "pre-wrap", marginTop: "var(--space-2)" }}>
                {draft.body}
              </p>
              <button type="button" disabled={isPending}
                onClick={() => run(draft.id, async () => {
                  const result = await pushLeadReplyDraft(draft.id);
                  if (!result.pushed) throw new Error(result.reason);
                  setNote("Reply pushed to Gmail.");
                })} style={{ ...buttonStyle("secondary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === draft.id ? "Pushing…" : "Push to Gmail"}
              </button>
            </Card>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <CardTitle>Prospects</CardTitle>
        {unavailable.prospects ? <Unavailable section="Prospects are" /> : prospects.length === 0 ? (
          <EmptyState title="No prospects yet" body="Paste an inquiry above to get started." />
        ) : prospects.map((p) => (
          <Card key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "flex-start", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <div>
                <CardTitle>{p.name ?? "Unnamed prospect"}</CardTitle>
                <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)", marginTop: "var(--space-1)" }}>
                  {p.email ?? "No email given"} {p.service_interest ? `· ${p.service_interest}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Badge tone={URGENCY_TONE[p.urgency]}>{p.urgency}</Badge>
                <Badge tone={p.status === "converted" ? "ok" : "neutral"}>{p.status}</Badge>
              </div>
            </div>
            {p.status !== "converted" && (
              <button type="button" disabled={isPending}
                onClick={() => run(p.id, async () => {
                  await convertProspect(p.id);
                  setNote("Converted to a client.");
                })} style={{ ...buttonStyle("secondary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === p.id ? "Converting…" : "Convert to client"}
              </button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
