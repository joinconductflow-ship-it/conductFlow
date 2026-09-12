/**
 * Capabilities are asked for one at a time, each with the narrowest scope that does the job.
 * Nobody is asked for Gmail access in order to log in.
 */
export const CAPABILITIES = {
  drive_templates: {
    label: "Use templates and create Google Docs",
    detail: "Reads only files you pick and creates private Docs for approved actions.",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  },
  calendar_context: {
    label: "Check availability and create Calendar events",
    detail: "Checks the primary calendar and creates only events you explicitly approve.",
    scopes: ["https://www.googleapis.com/auth/calendar.events.owned"],
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
