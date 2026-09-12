import type { GmailMessage, GmailMessagePart } from "./client";

export interface InboundMessage {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  /** Epoch milliseconds this message was received. */
  receivedAtMs: number;
  bodyText: string;
}

function headerValue(payload: GmailMessagePart, name: string): string | null {
  const header = payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

/** `"Priya Sharma" <priya@example.com>` and bare `priya@example.com` both occur in From. */
export function parseFromHeader(value: string): { name: string | null; email: string } {
  const match = value.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^<>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    return { name: name && name.length > 0 ? name : null, email: match[2].trim().toLowerCase() };
  }
  return { name: null, email: value.trim().toLowerCase() };
}

/** Gmail's payload `data` is base64url with no padding — Node's base64 decoder wants padding. */
function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * Walks a (possibly multipart/nested) message body for the first usable text. Plain text is
 * preferred; HTML is stripped to text only if no plain part exists, since a tag soup fed to
 * the extraction model would just be noise for it to filter back out.
 */
function extractText(part: GmailMessagePart): { plain: string | null; html: string | null } {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return { plain: decodeBase64Url(part.body.data), html: null };
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return { plain: null, html: decodeBase64Url(part.body.data) };
  }
  let plain: string | null = null;
  let html: string | null = null;
  for (const child of part.parts ?? []) {
    const found = extractText(child);
    plain ??= found.plain;
    html ??= found.html;
    if (plain) break;
  }
  return { plain, html };
}

function stripHtml(html: string): string {
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

/**
 * Turns a raw Gmail API message into what the extraction pipeline needs. Returns null for a
 * message with no From header or no readable body — nothing downstream can do anything with
 * either, and a message like that is not worth surfacing to the caller as a partial result.
 */
export function parseInboundMessage(message: GmailMessage): InboundMessage | null {
  const fromHeader = headerValue(message.payload, "From");
  if (!fromHeader) return null;
  const { name, email } = parseFromHeader(fromHeader);

  const { plain, html } = extractText(message.payload);
  const bodyText = plain ?? (html ? stripHtml(html) : null);
  if (!bodyText || !bodyText.trim()) return null;

  const subject = headerValue(message.payload, "Subject") ?? "(no subject)";
  const internalDate = Number(message.internalDate);

  return {
    id: message.id,
    fromEmail: email,
    fromName: name,
    subject,
    receivedAtMs: Number.isFinite(internalDate) ? internalDate : Date.now(),
    bodyText: bodyText.trim(),
  };
}
