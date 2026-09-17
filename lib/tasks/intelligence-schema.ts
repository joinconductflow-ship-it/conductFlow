import { z } from "zod";

const MAX_FIELD_CHARS = 1_000;
const MAX_BASIS_CHARS = 500;
const MAX_REASON_CHARS = 500;
const MAX_EVIDENCE_REFS = 8;

const evidenceRef = z.string().trim().min(1).max(200)
  .regex(/^(transcript|conversation|source_span|commitment|task|action):[^\s]+$/,
    "Evidence references must identify a stored source.");
const evidenceRefs = z.array(evidenceRef).min(1).max(MAX_EVIDENCE_REFS);

const generatedText = z.object({
  text: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  basis: z.string().trim().min(1).max(MAX_BASIS_CHARS),
  evidence_refs: evidenceRefs,
}).strict();

export const intelligenceRecommendationSchema = z.object({
  text: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  basis: z.string().trim().min(1).max(MAX_BASIS_CHARS),
  category: z.enum(["review", "follow_up", "prepare_document", "schedule", "clarify", "none"]),
  action_kind: z.enum(["gmail_draft", "calendar_event", "drive_document", "internal_task", "review", "none"]),
  evidence_refs: evidenceRefs,
}).strict();

export const intelligenceUsefulActionSchema = z.object({
  kind: z.enum(["gmail_draft", "drive_document", "calendar_event", "review", "none"]),
  text: z.string().trim().min(1).max(MAX_FIELD_CHARS),
  basis: z.string().trim().min(1).max(MAX_BASIS_CHARS),
  evidence_refs: evidenceRefs,
}).strict();

export const intelligenceAttentionReasonSchema = z.object({
  code: z.enum(["overdue", "missing_owner", "missing_due", "action_failed", "action_blocked"]),
  text: z.string().trim().min(1).max(MAX_REASON_CHARS),
  basis: z.string().trim().min(1).max(MAX_BASIS_CHARS),
  evidence_refs: evidenceRefs,
}).strict();

/** Model output is explanatory only; source facts and exact quotes are server-authored. */
export const taskIntelligenceOutputSchema = z.object({
  context: generatedText.nullable(),
  why_it_matters: generatedText.nullable(),
  recommendation: intelligenceRecommendationSchema.nullable(),
  useful_existing_action: intelligenceUsefulActionSchema.nullable(),
  attention_reason: intelligenceAttentionReasonSchema.nullable(),
}).strict();

export type TaskIntelligenceOutput = z.infer<typeof taskIntelligenceOutputSchema>;
