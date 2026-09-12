"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { approveDetectedActions, rejectCommitment } from "@/app/actions/approvals";
import { buttonStyle } from "@/components/ui/primitives";
import type { CommitmentActionSuggestion, SuggestedActionType } from "@/lib/types";

const REASON_TEXT: Record<string, string> = {
  missing: "Connect Gmail in settings, then try again.",
  revoked: "Reconnect Gmail in settings, then try again.",
  turned_off: "Your blueprint has Gmail draft creation set to never.",
  needs_approval: "That action needs approval before it can run.",
  prohibited: "That action is prohibited and cannot be enabled.",
  unknown_action: "The assistant asked for an action this blueprint does not define.",
  "no draft to push": "Draft content is needed before Gmail can create the draft.",
  google_reconnect_required: "Reconnect Google in settings, then try again.",
  gmail_auth_rejected_retry: "Gmail rejected the saved session. Try once more or reconnect Google.",
};

const ACTION_ORDER: SuggestedActionType[] = [
  "gmail_draft", "calendar_event", "drive_document", "internal_task",
];

const ACTION_COPY: Record<SuggestedActionType, {
  app: string;
  title: string;
  proposedOnly?: boolean;
}> = {
  gmail_draft: { app: "Gmail", title: "Create draft" },
  calendar_event: { app: "Calendar", title: "Create event", proposedOnly: true },
  drive_document: { app: "Drive", title: "Create/update document", proposedOnly: true },
  internal_task: { app: "Task", title: "Track commitment" },
};

function ActionIcon({ type }: { type: SuggestedActionType }) {
  const common = { width: 17, height: 17, fill: "none", stroke: "currentColor",
    strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const icons: Record<SuggestedActionType, ReactNode> = {
    gmail_draft: <svg viewBox="0 0 24 24" {...common}><path d="M3.5 6.5 12 13l8.5-6.5"/><path d="M4 6h16v12H4z"/></svg>,
    calendar_event: <svg viewBox="0 0 24 24" {...common}><path d="M6 3v4M18 3v4M4 9h16"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 13h3v3H8z"/></svg>,
    drive_document: <svg viewBox="0 0 24 24" {...common}><path d="m9 3-6 11 3.5 6h11L21 14 15 3z"/><path d="m9 3 6 11M21 14H9l-2.5 6"/></svg>,
    internal_task: <svg viewBox="0 0 24 24" {...common}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/></svg>,
  };
  return <span aria-hidden style={{ width: 30, height: 30, display: "grid", placeItems: "center",
    color: "var(--accent-text)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", background: "var(--surface)", flexShrink: 0 }}>{icons[type]}</span>;
}

export function humanizeMissingData(missing: readonly string[]): string | null {
  const values = missing.map((value) => value.toLowerCase());
  if (values.some((value) => /recipient|email|attendee/.test(value))) return "Recipient needed";
  if (values.some((value) => /time|date|start|end/.test(value))) return "Time needed";
  if (values.some((value) => /owner|assignee/.test(value))) return "Owner needed";
  if (values.some((value) => /document|title|content|file/.test(value))) return "Details needed";
  if (values.length > 0) return "More detail needed";
  return null;
}

function confidenceLabel(action: CommitmentActionSuggestion): string {
  return humanizeMissingData(action.missing_data) ??
    `${action.confidence[0].toUpperCase()}${action.confidence.slice(1)} confidence`;
}

export function ApprovalBar({ commitmentId, actions }: {
  commitmentId: string;
  actions: CommitmentActionSuggestion[];
}) {
  const router = useRouter();
  const orderedActions = [...actions].sort((a, b) =>
    ACTION_ORDER.indexOf(a.action_type) - ACTION_ORDER.indexOf(b.action_type));
  const [selected, setSelected] = useState(() => new Set(actions.map((action) => action.id)));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "partial" | "error"; text: string } | null>(null);
  const [acting, setActing] = useState<"approve" | "discard" | null>(null);
  const selectedCount = selected.size;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function approve() {
    setMessage(null);
    setActing("approve");
    startTransition(async () => {
      try {
        const result = await approveDetectedActions(commitmentId, [...selected]);
        if (result.gmail && !result.gmail.pushed && result.gmail.reason) {
          setMessage({ kind: "partial", text: result.gmail.reason });
          router.refresh();
          return;
        }
        router.push("/queue");
        router.refresh();
      } catch (cause) {
        setMessage({ kind: "error", text: cause instanceof Error
          ? cause.message : "Something went wrong. Please try again." });
      }
    });
  }

  function discard() {
    setMessage(null);
    setActing("discard");
    startTransition(async () => {
      try {
        await rejectCommitment(commitmentId);
        router.push("/queue");
        router.refresh();
      } catch (cause) {
        setMessage({ kind: "error", text: cause instanceof Error
          ? cause.message : "Something went wrong. Please try again." });
      }
    });
  }

  const cta = selectedCount === 0 ? "Select an action"
    : selectedCount === 1 ? "Approve action" : `Approve ${selectedCount} actions`;

  return (
    <section aria-busy={isPending} style={{ position: "relative", overflow: "hidden",
      marginTop: "var(--space-5)", background: "var(--raised)",
      border: "1px solid var(--border-strong)", borderRadius: "var(--radius)",
      padding: "var(--space-4)" }}>
      {isPending && <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0,
        height: 2, background: "var(--accent)", animation: "cf-pulse 1.4s ease-in-out infinite" }} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
        gap: "var(--space-3)" }}>
        <h2 style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>Detected actions</h2>
        {actions.length > 0 && <span className="mono" style={{ color: "var(--faint)",
          fontSize: "var(--text-xs)" }}>{selectedCount} selected</span>}
      </div>

      {orderedActions.length === 0 ? (
        <p style={{ marginTop: "var(--space-3)", color: "var(--muted)", fontSize: "var(--text-sm)" }}>
          No follow-up actions were suggested for this commitment.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          {orderedActions.map((action) => {
            const copy = ACTION_COPY[action.action_type];
            const isSelected = selected.has(action.id);
            return (
              <button key={action.id} type="button" aria-pressed={isSelected}
                className="detected-action-row"
                disabled={isPending} onClick={() => toggle(action.id)}
                style={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr) auto",
                  alignItems: "center", gap: "var(--space-3)", width: "100%", minHeight: 58,
                  padding: "9px 11px", textAlign: "left", color: "var(--text)",
                  background: isSelected ? "var(--accent-quiet)" : "var(--surface)",
                  border: `1px solid ${isSelected ? "var(--accent-line)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)", cursor: isPending ? "not-allowed" : "pointer",
                  opacity: isPending ? 0.6 : 1, transition: "background var(--motion), border-color var(--motion)" }}>
                <ActionIcon type={action.action_type} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600 }}>
                    <span style={{ color: "var(--muted)", fontWeight: 500 }}>{copy.app}</span>
                    <span aria-hidden style={{ color: "var(--faint)", margin: "0 6px" }}>·</span>
                    {copy.title}
                  </span>
                  <span style={{ display: "block", marginTop: 2, color: "var(--muted)",
                    fontSize: "var(--text-xs)", lineHeight: 1.35 }}>
                    {action.rationale}{copy.proposedOnly ? " Proposed only for now." : ""}
                  </span>
                </span>
                <span className="mono detected-action-state" style={{ color: humanizeMissingData(action.missing_data)
                  ? "var(--warn)" : "var(--faint)", fontSize: "var(--text-xs)", whiteSpace: "nowrap",
                  textAlign: "right" }}>{confidenceLabel(action)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)",
        flexWrap: "wrap" }}>
        {actions.length > 0 && <button disabled={isPending || selectedCount === 0} onClick={approve}
          style={{ ...buttonStyle("primary", isPending || selectedCount === 0), minWidth: 150 }}>
          {isPending && acting === "approve" ? "Approving…" : cta}
        </button>}
        <button disabled={isPending} onClick={discard}
          style={{ ...buttonStyle("ghost", isPending), minWidth: 92 }}>
          {isPending && acting === "discard" ? "Discarding…" : "Discard"}
        </button>
      </div>

      {message && <p role="alert" style={{ marginTop: "var(--space-3)",
        color: message.kind === "partial" ? "var(--warn)" : "var(--danger-text)" }}>
        {message.kind === "partial" ? <>
          The selected actions were approved, but Gmail could not create the draft. {" "}
          <span className="mono" style={{ color: "var(--muted)" }}>
            {REASON_TEXT[message.text] ?? message.text}
          </span>
        </> : <span className="mono">{message.text}</span>}
      </p>}
    </section>
  );
}
