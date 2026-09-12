"use client";

import { useState, type CSSProperties } from "react";
import type { z } from "zod";
import { CopilotSidebar, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { ToolCallStatus } from "@copilotkit/core";
import { proposeActionParameters } from "@/lib/copilot/schemas";

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
    background: kind === "approve" ? "var(--accent, #6366f1)" : "transparent",
    color: kind === "approve" ? "#fff" : "var(--text, #eee)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  };
}

type ProposalArgs = z.infer<typeof proposeActionParameters>;

/**
 * The "wow" surface: proposeAction is a pure FRONTEND human-in-the-loop tool
 * (see lib/copilot/tools.ts for why it's not a backend tool). The model calls
 * it, this pauses the run via a Promise, renders the exact proposed action as
 * a real preview card (not a JSON dump), and respond() resolves that Promise
 * — CopilotKit feeds the result back to the agent and continues the run
 * automatically. Only after an explicit Approve does the model go on to call
 * executeApprovedAction, the bridge into the existing approveDetectedActions
 * server action.
 */
function ProposalCard() {
  useHumanInTheLoop<ProposalArgs>({
    name: "proposeAction",
    description:
      "Proposes creating one Google Calendar event, Drive document, Gmail draft, or " +
      "internal task for a commitment. commitmentId and actionId MUST come from a " +
      "prior listOpenCommitments call in this conversation — call listOpenCommitments " +
      "first if you haven't already, even if the human named the commitment; never " +
      "invent or guess these ids. This does NOT create anything by itself — it " +
      "pauses so the human can review and approve or reject. The result you get back " +
      "is {approved: boolean}. If approved is true, you MUST immediately call " +
      "executeApprovedAction next, in the same turn, passing the same " +
      "commitmentId/actionId/fields plus approved: true — do not just describe " +
      "success in text, actually call the tool. If approved is false, tell the human " +
      "it was skipped and do not call executeApprovedAction.",
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

function ProposalCardBody({ args, respond }: {
  args: ProposalArgs;
  respond: (result: unknown) => Promise<void>;
}) {
  const [state, setState] = useState<"pending" | "sent">("pending");

  async function decide(approved: boolean) {
    setState("sent");
    await respond({ approved });
  }

  return <div style={cardStyle}>
    <div style={rowStyle}>
      <strong>{ACTION_TITLE[args.actionType]}</strong>
      <span style={labelStyle}>{args.actionType}</span>
    </div>
    <p style={{ margin: 0 }}>{args.summary}</p>
    {args.actionType === "calendar_event" && (args.date || args.startTime) && (
      <div style={{ display: "grid", gap: 2 }}>
        {args.date && <span style={labelStyle}>Date: <span style={{ color: "var(--text, #eee)" }}>{args.date}</span></span>}
        {args.startTime && <span style={labelStyle}>Time: <span style={{ color: "var(--text, #eee)" }}>{args.startTime}</span></span>}
        {args.durationMinutes && <span style={labelStyle}>Duration: <span style={{ color: "var(--text, #eee)" }}>{args.durationMinutes} min</span></span>}
      </div>
    )}
    {args.actionType === "drive_document" && args.documentTitle && (
      <span style={labelStyle}>Title: <span style={{ color: "var(--text, #eee)" }}>{args.documentTitle}</span></span>
    )}
    {state === "pending" ? (
      <div style={buttonRowStyle}>
        <button style={actionButton("approve")} onClick={() => decide(true)}>Approve</button>
        <button style={actionButton("reject")} onClick={() => decide(false)}>Reject</button>
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
