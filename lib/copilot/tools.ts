import { z } from "zod";
import { defineTool } from "@copilotkit/runtime/v2";
import {
  getCurrentOrgId,
  listCommitments,
  getActionSuggestionsForCommitment,
} from "@/lib/db/queries";

/**
 * Backend tools for the ConductFlow approval copilot. Read-only listing plus a
 * proposal step that PAUSES the run (interrupt: true) so the human confirms in
 * the chat UI before anything real happens — the actual Google API call still
 * only ever runs through the existing approveDetectedActions server action.
 */

const listOpenCommitmentsParameters = z.object({});

export const listOpenCommitmentsTool = defineTool({
  name: "listOpenCommitments",
  description:
    "Lists commitments awaiting review for the signed-in user's organization, " +
    "including each commitment's suggested actions (calendar_event, drive_document, " +
    "gmail_draft, internal_task) and what input each action still needs before it " +
    "can be approved. Read-only — creates or changes nothing.",
  parameters: listOpenCommitmentsParameters,
  execute: async () => {
    const orgId = await getCurrentOrgId("copilot: listOpenCommitments");
    if (!orgId) return { error: "Not signed in to a workspace." };
    const commitments = (await listCommitments(orgId))
      .filter((c) => c.status === "proposed");
    const withActions = await Promise.all(commitments.map(async (commitment) => {
      const actions = await getActionSuggestionsForCommitment(commitment.id);
      return {
        commitmentId: commitment.id,
        text: commitment.text,
        owner: commitment.owner,
        deadline: commitment.deadline,
        actions: actions.map((action) => ({
          actionId: action.id,
          type: action.action_type,
          state: action.execution_state ?? "proposed",
          missingData: action.missing_data,
          inputData: action.input_data ?? {},
        })),
      };
    }));
    return { commitments: withActions };
  },
});

const proposeActionParameters = z.object({
  commitmentId: z.string().describe("The commitment this action belongs to."),
  actionId: z.string().describe("The suggested action's id, from listOpenCommitments."),
  actionType: z.enum(["calendar_event", "drive_document", "gmail_draft", "internal_task"]),
  summary: z.string().describe(
    "One plain-English sentence describing exactly what will be created, for the " +
    "human to read before approving — e.g. \"Calendar event 'Makeup session — Priya " +
    "Sharma' on Sep 16 at 3:00 PM for 30 minutes.\"",
  ),
  date: z.string().optional().describe("YYYY-MM-DD, for calendar_event."),
  startTime: z.string().optional().describe("24h HH:MM, for calendar_event."),
  durationMinutes: z.number().optional().describe("For calendar_event."),
  documentTitle: z.string().optional().describe("For drive_document."),
  documentDetails: z.string().optional().describe(
    "What the document should include, for drive_document, if not already known.",
  ),
});

/**
 * Interrupt tool: the model calls this to propose one action. The run pauses
 * here — no execute() — and resumes only once the human responds in the chat
 * UI (see ApprovalCopilotSidebar's useHumanInTheLoop). Splitting "propose"
 * from "execute" is what keeps this a real approval gate instead of the model
 * silently deciding to act.
 */
export const proposeActionTool = defineTool({
  name: "proposeAction",
  description:
    "Proposes creating one Google Calendar event, Drive document, Gmail draft, or " +
    "internal task for a commitment. This does NOT create anything by itself — it " +
    "pauses so the human can review and approve or reject in the chat UI. The tool " +
    "result you get back after the human responds is {approved: boolean}. If " +
    "approved is true, you MUST immediately call executeApprovedAction next, in the " +
    "same turn, passing the same commitmentId/actionId/fields plus approved: true — " +
    "do not just describe success in text, actually call the tool. If approved is " +
    "false, tell the human it was skipped and do not call executeApprovedAction.",
  parameters: proposeActionParameters,
  interrupt: true,
  interruptReason: "action_approval",
  interruptMessage: "Review the proposed action before it is created.",
});

const executeApprovedActionParameters = z.object({
  commitmentId: z.string(),
  actionId: z.string(),
  approved: z.boolean().describe("Must be true — only call this after human approval."),
  date: z.string().optional(),
  startTime: z.string().optional(),
  durationMinutes: z.number().optional(),
  documentTitle: z.string().optional(),
  documentDetails: z.string().optional(),
  relativeDateConfirmed: z.boolean().optional(),
  conflictConfirmed: z.boolean().optional(),
});

/**
 * Calls the existing, already-battle-tested approveDetectedActions server
 * action. No Google/Supabase logic lives here — this is a thin bridge so the
 * agent's tool call ends up going through the exact same code path as the
 * manual queue UI.
 */
export const executeApprovedActionTool = defineTool({
  name: "executeApprovedAction",
  description:
    "Creates the previously proposed action for real (Calendar event, Drive doc, " +
    "Gmail draft, or task) after the human has approved it. Only call this with " +
    "approved: true, immediately after the human confirms a proposeAction call.",
  parameters: executeApprovedActionParameters,
  execute: async (args) => {
    if (!args.approved) return { error: "Not approved — nothing was created." };
    const { approveDetectedActions } = await import("@/app/actions/approvals");
    const inputData: Record<string, unknown> = {};
    if (args.date) inputData.date = args.date;
    if (args.startTime) inputData.start_time = args.startTime;
    if (args.durationMinutes) inputData.duration_minutes = args.durationMinutes;
    if (args.documentTitle) inputData.document_title = args.documentTitle;
    if (args.documentDetails) inputData.document_details = args.documentDetails;
    if (args.relativeDateConfirmed) inputData.relative_date_confirmed = true;
    if (args.conflictConfirmed) inputData.conflict_confirmed = true;
    try {
      const result = await approveDetectedActions(
        args.commitmentId,
        [args.actionId],
        { [args.actionId]: inputData },
      );
      return result;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Approval failed." };
    }
  },
});

export const copilotTools = [
  listOpenCommitmentsTool,
  proposeActionTool,
  executeApprovedActionTool,
];
