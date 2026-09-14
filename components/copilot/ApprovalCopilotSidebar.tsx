"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { z } from "zod";
import { CopilotSidebar, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { ToolCallStatus } from "@copilotkit/core";
import { approveDetectedActions } from "@/app/actions/approvals";
import { verifyCopilotProposal, type CopilotProposalCheck } from "@/app/actions/copilot";
import {
  proposeActionParameters,
  runProposalDecision,
  type ProposalValues,
} from "@/lib/copilot/schemas";
import { presentError } from "@/lib/errors/presentation";

// A stalled eligibility lookup must not leave the proposeAction interrupt unresolved.
const CHECK_TIMEOUT_MS = 12_000;

const cardStyle: CSSProperties = {
  border: "1px solid var(--border-strong, #444)",
  borderRadius: 10,
  padding: 14,
  background: "var(--raised, #1c1c1f)",
  color: "var(--text, #eee)",
  display: "grid",
  gap: 8,
  fontSize: 14,
  maxWidth: 360,
};

const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const labelStyle: CSSProperties = { color: "var(--faint, #888)", fontSize: 12 };
const buttonRowStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 4 };

function actionButton(kind: "approve" | "reject"): CSSProperties {
  return {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 8,
    border: kind === "approve" ? "none" : "1px solid var(--border-strong, #444)",
    // CopilotKit scopes its own `--accent` token to a near-white surface inside the sidebar.
    // Use the app accent-text token so Approve remains visibly actionable there.
    background: kind === "approve" ? "var(--accent-text, #4D50BC)" : "transparent",
    color: kind === "approve" ? "#fff" : "var(--text, #eee)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    transition: "filter 120ms ease, background 120ms ease",
  };
}

/* Inline styles can't express :hover, and this file intentionally avoids adding a
   client-only motion dependency to a card that's already deliberate about staying
   simple (see the architecture comments above) — a filter-based hover covers both
   button kinds with one rule. */
const actionButtonClass = "cf-copilot-action";

type ProposalArgs = z.infer<typeof proposeActionParameters>;

/**
 * The "wow" surface: proposeAction is a pure FRONTEND human-in-the-loop tool
 * (see lib/copilot/tools.ts for why it's not a backend tool). The model calls
 * it, this pauses the run via a Promise, and renders the exact proposed action
 * as a real preview card (not a JSON dump). On Approve, the card builds the
 * authoritative payload from UI state and calls the existing
 * approveDetectedActions server action itself — then responds, which is what
 * resumes the run, so the model only ever narrates the already-executed result.
 */
function ProposalCard() {
  useHumanInTheLoop<ProposalArgs>({
    name: "proposeAction",
    description:
      "Proposes creating one Google Calendar event, Drive document, Gmail draft, or " +
      "internal task for a commitment. commitmentId and actionId MUST come from a " +
      "prior listOpenCommitments call in this conversation — call listOpenCommitments " +
      "first if you haven't already, even if the human named the commitment; never " +
      "invent or guess these ids. Resolve every relative date against the dateContext " +
      "returned by listOpenCommitments and pass the human's original phrase as dateText; " +
      "never invent a year or a date. This pauses so the human can review, edit, and " +
      "approve or reject. Approval executes the action automatically in the UI, before " +
      "this tool returns — there is no execute tool to call. The result you get back " +
      "is {approved: boolean, execution?: {actions, complete}} describing what was " +
      "already created (or the error). Do NOT call any other tool to create the " +
      "action, and never restate or alter the executed values. If approved is false, " +
      "tell the human it was skipped.",
    parameters: proposeActionParameters,
    render: ({ status, args, respond }) => {
      if (status !== ToolCallStatus.Executing || !respond) {
        return <div style={cardStyle}>Proposal resolved.</div>;
      }
      return <ProposalCardBody args={args as ProposalArgs} respond={respond} />;
    },
  });
  return null;
}

const ACTION_TITLE: Record<ProposalArgs["actionType"], string> = {
  calendar_event: "Create Calendar event",
  drive_document: "Create Drive document",
  gmail_draft: "Create Gmail draft",
  internal_task: "Track as internal task",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "5px 7px",
  borderRadius: 6,
  border: "1px solid var(--border-strong, #444)",
  background: "var(--surface, #111)",
  color: "var(--text, #eee)",
  fontSize: 13,
};

function ProposalCardBody({ args, respond }: {
  args: ProposalArgs;
  respond: (result: unknown) => Promise<void>;
}) {
  const [state, setState] = useState<"pending" | "sent">("pending");
  // Canonical eligibility is verified server-side before any action controls render. A
  // fabricated or stale id can never become an actionable card or reach execution.
  const [check, setCheck] = useState<CopilotProposalCheck | null>(null);
  // The proposeAction interrupt is resolved exactly once. Any state that can't offer a normal
  // decision still has a guaranteed respond (Cancel/Dismiss), so no tool call is left hanging.
  const respondedRef = useRef(false);
  // Ownership is tracked by which fields the human touched, independent of the value, so a
  // cleared field is still reviewer-owned and cannot fall back to a source default. Clearing
  // itself is tracked separately: only an explicitly emptied field is in `cleared`.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  const [values, setValues] = useState<ProposalValues>(() => ({
    date: args.date ?? "",
    startTime: args.startTime ?? "",
    durationMinutes: args.durationMinutes !== undefined ? String(args.durationMinutes) : "",
    documentTitle: args.documentTitle ?? "",
    documentDetails: args.documentDetails ?? "",
  }));

  async function resolveOnce(result: unknown) {
    if (respondedRef.current) return;
    respondedRef.current = true;
    setState("sent");
    await respond(result);
  }

  useEffect(() => {
    let active = true;
    const failPending = (message: string) => {
      if (!active || respondedRef.current) return;
      setCheck({ eligible: false, message });
      // Resolve immediately: a check that never returns must not strand the tool call.
      void resolveOnce({ approved: false, ineligible: true, message });
    };
    const timeout = setTimeout(
      () => failPending("I couldn't verify that commitment in time. Please try again."),
      CHECK_TIMEOUT_MS,
    );
    verifyCopilotProposal({
      commitmentId: args.commitmentId,
      actionId: args.actionId,
      actionType: args.actionType,
      dateText: args.dateText,
    })
      .then((result) => {
        if (!active) return;
        clearTimeout(timeout);
        setCheck(result);
        if (result.eligible && result.resolvedDate) {
          // The authoritative server resolution supersedes the model's date guess. The human
          // has not edited anything yet, so this is a system default, not reviewer ownership.
          // The resolved date is also an explicit server confirmation of the relative phrase;
          // preserve that confirmation in the approval payload so Calendar readiness does not
          // require a second, unavailable checkbox in the Copilot card.
          setValues((current) => ({
            ...current,
            date: result.resolvedDate!,
            relativeDateConfirmed: true,
          }));
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        failPending("I couldn't verify that commitment. Please try again.");
      });
    return () => { active = false; clearTimeout(timeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.commitmentId, args.actionId, args.actionType, args.dateText]);

  async function dismissIneligible() {
    await resolveOnce({ approved: false, ineligible: true, message: check?.message });
  }

  function patch(key: keyof ProposalValues, value: string) {
    setTouched((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setCleared((current) => {
      const isEmpty = value === "";
      if (isEmpty && !current.has(key)) return new Set(current).add(key);
      if (!isEmpty && current.has(key)) {
        const next = new Set(current);
        next.delete(key);
        return next;
      }
      return current;
    });
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function decide(approved: boolean) {
    // Build and execute the authoritative payload from UI state, then resume the run with the
    // result. The model never carries the approved values or provenance.
    let result: unknown;
    try {
      result = await runProposalDecision(
        approved,
        { commitmentId: args.commitmentId, actionId: args.actionId },
        values,
        [...touched],
        [...cleared],
        async (payload) => {
          try {
            return await approveDetectedActions(
              payload.commitmentId,
              [payload.actionId],
              { [payload.actionId]: payload.inputData },
              payload.reviewerEditedFields.length > 0
                ? { [payload.actionId]: payload.reviewerEditedFields }
                : {},
              payload.clearedFields.length > 0
                ? { [payload.actionId]: payload.clearedFields }
                : {},
            );
          } catch (error) {
            return { error: presentError(error, {
              fallback: "Approval failed. Please try again.",
              authentication: "Please sign in again to approve this action.",
            }) };
          }
        },
      );
    } catch (error) {
      result = { approved: false, error: presentError(error, {
        fallback: "Approval failed. Please try again.",
        authentication: "Please sign in again to approve this action.",
      }) };
    }
    await resolveOnce(result);
  }

  if (check === null) {
    // Always offer a way to resolve the interrupt, even while the check is in flight.
    return <div style={cardStyle}>
      <span style={labelStyle}>Checking the commitment…</span>
      <div style={buttonRowStyle}>
        <button className={actionButtonClass} data-kind="reject" style={actionButton("reject")} onClick={() => dismissIneligible()}>Cancel</button>
      </div>
    </div>;
  }

  if (!check.eligible) {
    return <div style={cardStyle}>
      <div style={rowStyle}>
        <strong>Proposal unavailable</strong>
        <span style={labelStyle}>{args.actionType}</span>
      </div>
      <p style={{ margin: 0 }}>
        {check.message ?? "I don't have an eligible commitment to create this action from yet."}
      </p>
      {state === "pending"
        ? <div style={buttonRowStyle}>
          <button className={actionButtonClass} data-kind="reject" style={actionButton("reject")} onClick={dismissIneligible}>Dismiss</button>
        </div>
        : <span style={labelStyle}>Dismissed.</span>}
    </div>;
  }

  return <div style={cardStyle}>
    <div style={rowStyle}>
      <strong>{ACTION_TITLE[args.actionType]}</strong>
      <span style={labelStyle}>{args.actionType}</span>
    </div>
    <p style={{ margin: 0 }}>{args.summary}</p>
    {args.actionType === "calendar_event" && (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={labelStyle}>Date
          <input type="date" value={values.date} onChange={(e) => patch("date", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
        <label style={labelStyle}>Time
          <input type="time" value={values.startTime} onChange={(e) => patch("startTime", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
        <label style={labelStyle}>Duration, min
          <input type="number" min={5} max={1440} step={5} value={values.durationMinutes}
            onChange={(e) => patch("durationMinutes", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
      </div>
    )}
    {args.actionType === "drive_document" && (
      <div style={{ display: "grid", gap: 6 }}>
        <label style={labelStyle}>Title
          <input value={values.documentTitle} onChange={(e) => patch("documentTitle", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2 }} />
        </label>
        <label style={labelStyle}>Details
          <textarea value={values.documentDetails} rows={3}
            onChange={(e) => patch("documentDetails", e.target.value)}
            style={{ ...fieldStyle, marginTop: 2, resize: "vertical" }} />
        </label>
      </div>
    )}
    {state === "pending" ? (
      <div style={buttonRowStyle}>
        <button className={actionButtonClass} data-kind="approve" style={actionButton("approve")} onClick={() => decide(true)}>Approve</button>
        <button className={actionButtonClass} data-kind="reject" style={actionButton("reject")} onClick={() => decide(false)}>Reject</button>
      </div>
    ) : (
      <span style={labelStyle}>Sent.</span>
    )}
  </div>;
}

export function ApprovalCopilotSidebar() {
  return <>
    <ProposalCard />
    <CopilotSidebar
      labels={{
        modalHeaderTitle: "Approval copilot",
        welcomeMessageText: "Ask me about anything awaiting review — e.g. \"schedule the makeup session for Priya\".",
      }}
    />
  </>;
}
