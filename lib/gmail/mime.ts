import { createHash } from "node:crypto";

const CRLF = "\r\n";

export interface MessageParts {
  to: string | null | undefined;
  from: string;
  subject: string;
  body: string;
}

/**
 * A header value carrying CR or LF would let a client name inject extra headers, so it is
 * refused before assembly rather than escaped.
 */
function assertHeaderSafe(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} contains a line break and cannot go in a header.`);
  }
}

/**
 * RFC 2047 encoded-word. Applied unconditionally: an all-ASCII subject survives the round
 * trip unchanged, and a raw em dash or accented name in a header is not legal 7-bit.
 *
 * An encoded word may not exceed 75 characters, so the subject is chunked at 45 input
 * bytes — `=?UTF-8?B?` (10) + 60 base64 characters + `?=` (2) lands at 72. Chunks never
 * split a multi-byte character; continuation bytes are 10xxxxxx.
 */
function encodeSubject(subject: string): string {
  const bytes = Buffer.from(subject, "utf8");
  if (bytes.length === 0) return "";

  const MAX_CHUNK_BYTES = 45;
  const words: string[] = [];
  let start = 0;

  while (start < bytes.length) {
    let end = Math.min(start + MAX_CHUNK_BYTES, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    words.push(`=?UTF-8?B?${bytes.subarray(start, end).toString("base64")}?=`);
    start = end;
  }

  // Continuation lines start with a space: folding white space is how a long header wraps.
  return words.join(`${CRLF} `);
}

/** RFC 2045 caps a base64 line at 76 characters. */
function wrapBase64(encoded: string): string {
  return (encoded.match(/.{1,76}/g) ?? []).join(CRLF);
}

/**
 * Builds the RFC 2822 message and returns it base64url-encoded, which is what Gmail's
 * `raw` field takes — `-`/`_` for `+`/`/`, padding stripped. Standard base64 is rejected.
 *
 * The body is base64 with a matching Content-Transfer-Encoding, which sidesteps the
 * 998-octet line limit and quoted-printable's soft-break rules entirely.
 */
export function buildRawMessage(parts: MessageParts): string {
  const recipient = parts.to ?? "";
  assertHeaderSafe(recipient, "Recipient address");
  assertHeaderSafe(parts.from, "From address");
  assertHeaderSafe(parts.subject, "Subject");

  const headers = [
    `To: ${recipient}`,
    `From: ${parts.from}`,
    `Subject: ${encodeSubject(parts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].join(CRLF);

  const body = wrapBase64(Buffer.from(parts.body, "utf8").toString("base64"));
  const mime = `${headers}${CRLF}${CRLF}${body}`;

  return Buffer.from(mime, "utf8").toString("base64url");
}

/**
 * Hashes the base64url payload itself — the exact bytes handed to Gmail — so the audit row
 * proves what landed in the mailbox without storing a second copy of the body.
 */
export function hashRawMessage(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
