/**
 * Capabilities are asked for one at a time, each with the narrowest scope that does the job.
 * Nobody is asked for Gmail access in order to log in.
 */
export const CAPABILITIES = {
  drive_templates: {
    label: "Use our Drive templates",
    detail: "Reads only the template files you pick — never the rest of your Drive.",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  },
  calendar_context: {
    label: "Read meeting context from Calendar",
    detail: "Reads event titles and times around a conversation. Attendee emails are never stored.",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
  },
  gmail_drafts: {
    label: "Put follow-ups in my Gmail drafts",
    detail: "Writes drafts you send yourself. ConductFlow never sends anything.",
    scopes: ["https://www.googleapis.com/auth/gmail.compose"],
  },
  gmail_watch: {
    label: "Watch my inbox for new commitments",
    detail: "Reads incoming mail from your known clients and adds anything they ask for to your queue. Nothing is sent or shared — matched messages only ever become a proposed commitment you still approve.",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  },
} as const;

export type Capability = keyof typeof CAPABILITIES;

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(CAPABILITIES, value);
}

/** Identity only. Sign-in never asks for API access. */
export const SIGN_IN_SCOPES = "openid email profile";
