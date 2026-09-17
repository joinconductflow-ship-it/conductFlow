import type { GraphMailMessage } from "./graph";
import type { InboundMessage } from "@/lib/gmail/inbound";

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseInboundMessage(message: GraphMailMessage): InboundMessage | null {
  const fromEmail = message.from?.emailAddress?.address?.trim().toLowerCase();
  if (!fromEmail) return null;
  const content = message.body?.content ?? "";
  const bodyText = message.body?.contentType?.toLowerCase() === "html" ? stripHtml(content) : content.trim();
  if (!bodyText) return null;
  const received = Date.parse(message.receivedDateTime);
  return {
    id: message.id, fromEmail, fromName: message.from?.emailAddress?.name?.trim() || null,
    subject: message.subject ?? "(no subject)",
    receivedAtMs: Number.isFinite(received) ? received : Date.now(), bodyText,
  };
}
