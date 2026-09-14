import { z } from "zod";
import type { ActionInputData } from "@/lib/types";

/**
 * Shared with components/copilot/ApprovalCopilotSidebar.tsx, which registers
 * proposeAction as a pure FRONTEND tool via useHumanInTheLoop. Kept in its
 * own file (no server-only imports) so the client bundle doesn't pull in
 * lib/copilot/tools.ts's Supabase/server-action dependencies.
 */
export const proposeActionParameters = z.object({
  commitmentId: z.string().describe("The commitment this action belongs to."),
  actionId: z.string().describe("The suggested action's id, from listOpenCommitments."),
  actionType: z.enum(["calendar_event", "drive_document", "gmail_draft", "internal_task"]),
  summary: z.string().describe(
    "One plain-English sentence describing exactly what will be created, for the " +
    "human to read before approving — e.g. \"Calendar event 'Makeup session — Priya " +
    "Sharma' on Sep 16 at 3:00 PM for 30 minutes.\"",
  ),
  date: z.string().optional().describe(
    "YYYY-MM-DD, for calendar_event, resolved against the dateContext returned by " +
    "listOpenCommitments. Never guess the year.",
  ),
  dateText: z.string().optional().describe(
    "The human's original relative date phrase, verbatim, whenever they used one " +
    "(e.g. \"next Tuesday\", \"tomorrow\", \"this Friday\"). The server resolves it " +
    "authoritatively against the current date and org timezone; pass it alongside date.",
  ),
  startTime: z.string().optional().describe("24h HH:MM, for calendar_event."),
  durationMinutes: z.number().optional().describe("For calendar_event."),
  documentTitle: z.string().optional().describe("For drive_document."),
  documentDetails: z.string().optional().describe(
    "What the document should include, for drive_document, if not already known.",
  ),
});

/** Maps an editable proposal field to the ActionInputData key it becomes. */
export const PROPOSAL_FIELD_TO_INPUT: Readonly<Record<string, string>> = {
  date: "date",
  startTime: "start_time",
  durationMinutes: "duration_minutes",
  documentTitle: "document_title",
  documentDetails: "document_details",
};

/** The proposal card's editable values, as strings straight from the form. */
export interface ProposalValues {
  date: string;
  startTime: string;
  durationMinutes: string;
  documentTitle: string;
  documentDetails: string;
  /** Server-confirmed interpretation of a relative Calendar date. */
  relativeDateConfirmed?: boolean;
}

/** The exact, authoritative payload a human approval executes. */
export interface CopilotApprovalPayload {
  commitmentId: string;
  actionId: string;
  inputData: ActionInputData;
  reviewerEditedFields: string[];
  /** Fields the reviewer explicitly cleared. Separate from ownership; omission is not a clear. */
  clearedFields: string[];
}

/**
 * Reviewer ownership comes from which fields the human touched in the card, independent of
 * whether the resulting value is non-empty. Clearing a field still marks it reviewer-owned,
 * so a source-derived default cannot silently reappear.
 */
export function reviewerFieldsFromTouched(touched: readonly string[]): string[] {
  return [...new Set(touched
    .map((key) => PROPOSAL_FIELD_TO_INPUT[key])
    .filter((field): field is string => field !== undefined))];
}

/**
 * Builds the approval payload purely from UI state. No language-model output is consulted:
 * a cleared field is omitted from inputData but still recorded as reviewer-owned.
 */
export function buildCopilotApprovalPayload(
  identity: { commitmentId: string; actionId: string },
  values: ProposalValues,
  touched: readonly string[],
  cleared: readonly string[] = [],
): CopilotApprovalPayload {
  const inputData: ActionInputData = {};
  if (values.date) inputData.date = values.date;
  if (values.startTime) inputData.start_time = values.startTime;
  const duration = Number(values.durationMinutes);
  if (values.durationMinutes && Number.isFinite(duration)) inputData.duration_minutes = duration;
  if (values.documentTitle) inputData.document_title = values.documentTitle;
  if (values.documentDetails) inputData.document_details = values.documentDetails;
  if (values.relativeDateConfirmed) inputData.relative_date_confirmed = true;
  return {
    commitmentId: identity.commitmentId,
    actionId: identity.actionId,
    inputData,
    reviewerEditedFields: reviewerFieldsFromTouched(touched),
    clearedFields: reviewerFieldsFromTouched(cleared),
  };
}

/**
 * Runs one human decision deterministically. On reject the executor is never called. On
 * approve the payload is built from UI state and executed to completion before this resolves;
 * only then does the caller resume the Copilot run, so the model can narrate the result but
 * cannot transport, omit, mutate, or reinterpret what was approved.
 */
export async function runProposalDecision(
  approved: boolean,
  identity: { commitmentId: string; actionId: string },
  values: ProposalValues,
  touched: readonly string[],
  cleared: readonly string[],
  execute: (payload: CopilotApprovalPayload) => Promise<unknown>,
): Promise<{ approved: boolean; execution?: unknown }> {
  if (!approved) return { approved: false };
  const payload = buildCopilotApprovalPayload(identity, values, touched, cleared);
  const execution = await execute(payload);
  return { approved: true, execution };
}
