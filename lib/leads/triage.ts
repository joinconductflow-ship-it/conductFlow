import type { SupabaseClient } from "@supabase/supabase-js";
import type { LanguageModel } from "ai";
import {
  leadTriageSchema, EXTRACTION_MODEL, MAX_INQUIRY_CHARS, type LeadTriage,
} from "@/lib/agent/schema";
import { LEAD_TRIAGE_SYSTEM_PROMPT, buildLeadTriagePrompt } from "@/lib/agent/prompts";
import { sanitizeIngested } from "@/lib/agent/injection";
import { generateObjectWithRetry } from "@/lib/agent/generate";
import { canExecute } from "@/lib/agent/execute-policy";
import { contractFor } from "@/lib/agent/blueprint-store";
import { logAudit } from "@/lib/audit/log";

export interface TriageInquiryArgs {
  orgId: string;
  rawInquiry: string;
  now?: Date;
}

export interface TriageInquiryResult {
  prospectId: string;
  draftId: string | null;
  flagged: string[];
  triage: LeadTriage | null;
  denied?: string;
}

/**
 * The one entry point: an owner pastes a new inquiry (forwarded email, web form, DM —
 * whatever channel it came in on), and this extracts what's stated, classifies what kind
 * of reply it needs, and drafts one. No inbox watching, no webhook, no auto-send — pasting
 * the text IS the human action that authorizes drafting a reply, the same way clicking
 * "Rewrite draft" authorizes lib/drafts/regenerate.ts.
 */
export async function triageInquiry(
  db: SupabaseClient, args: TriageInquiryArgs, model?: LanguageModel,
): Promise<TriageInquiryResult> {
  if (!args.rawInquiry.trim()) throw new Error("Paste the inquiry text.");
  if (args.rawInquiry.length > MAX_INQUIRY_CHARS) {
    throw new Error(`Inquiry is too long: ${args.rawInquiry.length} characters (max ${MAX_INQUIRY_CHARS}).`);
  }

  const { flagged } = sanitizeIngested(args.rawInquiry);

  const { data: prospect, error: prospectError } = await db.from("prospect").insert({
    org_id: args.orgId, raw_inquiry: args.rawInquiry, status: "new",
  }).select("id").single();
  if (prospectError) throw prospectError;
  const prospectId = prospect.id as string;

  const contract = await contractFor(db, args.orgId);
  // Pasting the inquiry is itself the human action, same posture as regenerateDraftFor.
  const decision = canExecute("draft_lead_reply", true, contract, { sources: ["lead_inquiry"] });
  if (!decision.ok) {
    return { prospectId, draftId: null, flagged, triage: null, denied: decision.reason };
  }

  const triage = await generateObjectWithRetry({
    model: model ?? EXTRACTION_MODEL,
    system: LEAD_TRIAGE_SYSTEM_PROMPT,
    prompt: buildLeadTriagePrompt({ rawInquiry: args.rawInquiry }),
    schema: leadTriageSchema,
    operation: "lead_triage",
  });

  const { error: updateError } = await db.from("prospect").update({
    name: triage.name, email: triage.email, service_interest: triage.serviceInterest,
    urgency: triage.urgency,
  }).eq("id", prospectId).eq("org_id", args.orgId);
  if (updateError) throw updateError;

  const { data: draft, error: draftError } = await db.from("prospect_message_draft").insert({
    org_id: args.orgId, prospect_id: prospectId, kind: "lead_reply",
    subject: triage.replySubject, body: triage.replyBody,
  }).select("id").single();
  if (draftError) throw draftError;

  await logAudit({
    orgId: args.orgId, actor: "agent", action: "draft",
    target: `prospect:${prospectId}:triage`,
  });

  return { prospectId, draftId: draft.id as string, flagged, triage };
}

export interface ConvertProspectArgs {
  orgId: string;
  prospectId: string;
  now?: Date;
}

/**
 * A prospect becomes a client_contact the moment an owner decides to take them on —
 * never automatic, since "is this a real client now" is a business judgment call this
 * product has no basis for making on its own.
 */
export async function convertProspectToClient(
  db: SupabaseClient, args: ConvertProspectArgs,
): Promise<{ clientId: string }> {
  const { data: prospect, error } = await db.from("prospect")
    .select("id,org_id,name,email,status").eq("id", args.prospectId).maybeSingle();
  if (error) throw error;
  if (!prospect) throw new Error("prospect not found");
  if (prospect.org_id !== args.orgId) throw new Error("prospect not found");
  if (prospect.status === "converted") throw new Error("prospect already converted");

  const { data: client, error: clientError } = await db.from("client_contact").insert({
    org_id: args.orgId, name: (prospect.name as string | null) ?? "New client",
    email: prospect.email,
  }).select("id").single();
  if (clientError) throw clientError;

  const { error: updateError } = await db.from("prospect")
    .update({ status: "converted", converted_client_id: client.id })
    .eq("id", prospect.id).eq("org_id", args.orgId);
  if (updateError) throw updateError;

  await logAudit({
    orgId: args.orgId, actor: "human", action: "create",
    target: `prospect:${prospect.id}:convert`,
  });

  return { clientId: client.id as string };
}
