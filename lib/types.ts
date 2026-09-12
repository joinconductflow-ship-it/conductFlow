import type { TaskStatus } from "@/lib/tasks/transitions";

export type { TaskStatus };

export type Confidence = "high" | "medium" | "low";
export type SuggestedActionType = "gmail_draft" | "calendar_event" | "drive_document" | "internal_task";
export type ActionExecutionState =
  | "proposed"
  | "ready"
  | "needs_info"
  | "schedule_conflict"
  | "executing"
  | "created"
  | "failed"
  | "blocked"
  | "reconnect_google";

export interface ActionInputData {
  recipient?: string | null;
  event_type?: string;
  person?: string;
  date?: string;
  start_time?: string;
  duration_minutes?: number;
  time_zone?: string;
  location?: string;
  notes?: string;
  recurrence_rule?: string;
  recurrence_text?: string;
  relative_date?: boolean;
  relative_date_confirmed?: boolean;
  recurrence_confirmed?: boolean;
  conflict_confirmed?: boolean;
  document_title?: string;
  document_summary?: string;
  document_body?: string;
  document_details?: string;
  /**
   * Explicit provenance: which fields a reviewer has edited. Persisted inside `input_data`
   * so a reviewer decision survives refreshes and reloads without a schema migration. A
   * field listed here must not be overwritten by a later source-derived default.
   */
  reviewer_edited_fields?: string[];
  /**
   * Fields the reviewer explicitly cleared. Separate from ownership: a cleared field stays
   * reviewer-owned but must suppress base/source/planner/saved fallback until a new value is
   * submitted. Persisted inside `input_data`, so it survives refreshes and reloads.
   */
  reviewer_cleared_fields?: string[];
}

export interface ActionPreviewData {
  conflicts?: Array<{ id: string; title: string | null; start: string; end: string | null }>;
  gmail_doc_link_pending?: boolean;
}
export type CommitmentStatus = "proposed" | "approved" | "tasked" | "done" | "rejected";
export type Role = "owner" | "member";

export interface Org {
  id: string;
  name: string;
  created_at: string;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Commitment {
  id: string; org_id: string; conversation_id: string; client_id: string;
  text: string; owner: string | null; deadline: string | null;
  type: string; confidence: Confidence; source_span: string;
  status: CommitmentStatus; created_at: string; source_flagged: boolean;
}
export interface DeliverableDraft {
  id: string; org_id: string; commitment_id: string; kind: "email" | "recap";
  subject: string | null; body: string; created_at: string;
}

export interface CommitmentActionSuggestion {
  id: string;
  org_id: string;
  commitment_id: string;
  action_type: SuggestedActionType;
  confidence: Confidence;
  rationale: string;
  required_data: string[];
  missing_data: string[];
  input_data?: ActionInputData;
  preview_data?: ActionPreviewData;
  execution_state?: ActionExecutionState;
  external_id?: string | null;
  external_url?: string | null;
  last_error?: string | null;
  executing_at?: string | null;
  executed_at?: string | null;
  updated_at?: string;
  created_at: string;
}
export interface ApprovalEvent {
  id: string; org_id: string; subject_type: string; subject_id: string;
  state: "proposed" | "approved" | "rejected" | "executed";
  actor_user_id: string | null; created_at: string;
}

export interface Task {
  id: string; org_id: string; commitment_id: string;
  title: string; owner: string | null; due: string | null;
  status: TaskStatus; completed_at: string | null; completed_by: string | null;
  created_at: string;
}

export type ReminderState = "open" | "dismissed" | "resolved";

export interface Reminder {
  id: string; org_id: string; task_id: string;
  due_at: string; state: ReminderState; created_at: string;
}

export type ExtractionStatus = "pending" | "ok" | "failed";

export interface Transcript {
  id: string; org_id: string; conversation_id: string; body: string;
  injection_flags: string[]; extraction_status: ExtractionStatus;
  extraction_error: string | null;
}
