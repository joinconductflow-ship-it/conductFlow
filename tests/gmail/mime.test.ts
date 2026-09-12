import { describe, it, expect } from "vitest";
import { buildRawMessage, hashRawMessage } from "@/lib/gmail/mime";

const base = {
  to: "parent@example.com",
  from: "owner@demo.test",
  subject: "Mia's revised practice set",
  body: "Hi Ramirez family,\r\n\r\nConfirming the practice set lands Friday.\r\n\r\nBest,\r\nDemo Studio",
};

function decode(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

/** Reads a header back out of the decoded message, unfolding continuation lines. */
function header(mime: string, name: string): string {
  const headers = mime.split("\r\n\r\n")[0];
  const unfolded = headers.replace(/\r\n[ \t]/g, "");
  const line = unfolded.split("\r\n").find((l) => l.startsWith(`${name}: `));
  return line ? line.slice(name.length + 2) : "";
}

/**
 * RFC 2047 drops the folding whitespace between adjacent encoded words, so the decoded
 * chunks are concatenated as bytes before being read as UTF-8.
 */
function decodeEncodedWords(value: string): string {
  const words = value.match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]*\?=/g);
  if (!words) return value;
  return Buffer.concat(words.map((word) => {
    const payload = /=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/.exec(word)![1];
    return Buffer.from(payload, "base64");
  })).toString("utf8");
}

describe("buildRawMessage", () => {
  it("returns base64url with no padding", () => {
    const raw = buildRawMessage(base);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw).not.toContain("=");
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
  });

  it("carries the recipient, author, and MIME headers", () => {
    const mime = decode(buildRawMessage(base));
    expect(header(mime, "To")).toBe("parent@example.com");
    expect(header(mime, "From")).toBe("owner@demo.test");
    expect(header(mime, "MIME-Version")).toBe("1.0");
    expect(header(mime, "Content-Type")).toBe('text/plain; charset="UTF-8"');
    expect(header(mime, "Content-Transfer-Encoding")).toBe("base64");
  });

  it("leaves the To header blank when no recipient is available", () => {
    const mime = decode(buildRawMessage({ ...base, to: null }));
    expect(header(mime, "To")).toBe("");
    expect(header(mime, "From")).toBe("owner@demo.test");
    expect(decodeEncodedWords(header(mime, "Subject"))).toBe(base.subject);
    const encodedBody = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "");
    expect(encodedBody).toBe(Buffer.from(base.body, "utf8").toString("base64"));
  });

  it("encodes an ASCII subject as an encoded-word that round trips unchanged", () => {
    const mime = decode(buildRawMessage(base));
    const subject = header(mime, "Subject");
    expect(subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeEncodedWords(subject)).toBe("Mia's revised practice set");
  });

  it("keeps an em dash and an accented name intact through the header", () => {
    const subject = "Réunion — Mia's plan";
    const mime = decode(buildRawMessage({ ...base, subject }));
    expect(decodeEncodedWords(header(mime, "Subject"))).toBe(subject);
  });

  it("splits a long non-ASCII subject into encoded words that each stay under 75 characters", () => {
    const subject = "Réunion très importante — " + "prochaine étape détaillée ".repeat(4);
    const mime = decode(buildRawMessage({ ...base, subject }));
    const headers = mime.split("\r\n\r\n")[0];
    const words = headers.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? [];

    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeEncodedWords(header(mime, "Subject"))).toBe(subject);
  });

  it("preserves the body's line breaks", () => {
    const mime = decode(buildRawMessage(base));
    const body = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(base.body);
  });

  it("wraps the encoded body at 76 characters", () => {
    const long = "The revised practice set covers factoring in depth. ".repeat(20);
    const mime = decode(buildRawMessage({ ...base, body: long }));
    const body = mime.split("\r\n\r\n").slice(1).join("\r\n\r\n");

    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(long);
  });

  it("rejects a recipient carrying a line break", () => {
    expect(() => buildRawMessage({ ...base, to: "parent@example.com\r\nBcc: sneak@evil.test" }))
      .toThrow(/line break/i);
  });

  it("rejects a subject carrying a line break", () => {
    expect(() => buildRawMessage({ ...base, subject: "Practice set\nBcc: sneak@evil.test" }))
      .toThrow(/line break/i);
  });

  it("rejects an author address carrying a line break", () => {
    expect(() => buildRawMessage({ ...base, from: "owner@demo.test\rX-Evil: 1" }))
      .toThrow(/line break/i);
  });
});

describe("hashRawMessage", () => {
  it("is a stable sha256 hex digest of the payload", () => {
    const raw = buildRawMessage(base);
    expect(hashRawMessage(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRawMessage(raw)).toBe(hashRawMessage(raw));
  });

  it("changes when a single character of the message changes", () => {
    const a = hashRawMessage(buildRawMessage(base));
    const b = hashRawMessage(buildRawMessage({ ...base, subject: `${base.subject}.` }));
    expect(a).not.toBe(b);
  });
});
