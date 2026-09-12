import { describe, it, expect } from "vitest";
import { parseFromHeader, parseInboundMessage } from "@/lib/gmail/inbound";
import type { GmailMessage, GmailMessagePart } from "@/lib/gmail/client";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function message(payload: GmailMessagePart, internalDate = "1700000000000"): GmailMessage {
  return { id: "msg-1", threadId: "thread-1", internalDate, payload };
}

describe("parseFromHeader", () => {
  it("reads a display name and address out of a quoted From header", () => {
    expect(parseFromHeader('"Priya Sharma" <Priya@Example.com>'))
      .toEqual({ name: "Priya Sharma", email: "priya@example.com" });
  });

  it("reads an unquoted display name", () => {
    expect(parseFromHeader("Priya Sharma <priya@example.com>"))
      .toEqual({ name: "Priya Sharma", email: "priya@example.com" });
  });

  it("falls back to a bare address with no angle brackets", () => {
    expect(parseFromHeader("priya@example.com"))
      .toEqual({ name: null, email: "priya@example.com" });
  });
});

describe("parseInboundMessage", () => {
  it("decodes a single-part text/plain message", () => {
    const parsed = parseInboundMessage(message({
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "Priya Sharma <priya@example.com>" },
        { name: "Subject", value: "Re: this week" },
      ],
      body: { data: b64url("Can you send the revised practice set by Friday?") },
    }));

    expect(parsed).toEqual({
      id: "msg-1",
      fromEmail: "priya@example.com",
      fromName: "Priya Sharma",
      subject: "Re: this week",
      receivedAtMs: 1700000000000,
      bodyText: "Can you send the revised practice set by Friday?",
    });
  });

  it("prefers the text/plain part of a multipart/alternative message over text/html", () => {
    const parsed = parseInboundMessage(message({
      mimeType: "multipart/alternative",
      headers: [{ name: "From", value: "priya@example.com" }],
      parts: [
        { mimeType: "text/html", body: { data: b64url("<p>Hi <b>there</b></p>") } },
        { mimeType: "text/plain", body: { data: b64url("Hi there") } },
      ],
    }));

    expect(parsed?.bodyText).toBe("Hi there");
  });

  it("strips HTML tags when only an HTML part exists", () => {
    const parsed = parseInboundMessage(message({
      mimeType: "text/html",
      headers: [{ name: "From", value: "priya@example.com" }],
      body: { data: b64url("<p>Line one</p><p>Line two &amp; more</p>") },
    }));

    expect(parsed?.bodyText).toBe("Line one\n\nLine two & more");
  });

  it("returns null when there is no From header", () => {
    const parsed = parseInboundMessage(message({
      mimeType: "text/plain",
      headers: [],
      body: { data: b64url("hello") },
    }));
    expect(parsed).toBeNull();
  });

  it("returns null when no part has readable text", () => {
    const parsed = parseInboundMessage(message({
      mimeType: "multipart/mixed",
      headers: [{ name: "From", value: "priya@example.com" }],
      parts: [{ mimeType: "application/pdf", body: { data: b64url("binary") } }],
    }));
    expect(parsed).toBeNull();
  });

  it("falls back to now() for an unparseable internalDate rather than throwing", () => {
    const parsed = parseInboundMessage(message({
      mimeType: "text/plain",
      headers: [{ name: "From", value: "priya@example.com" }],
      body: { data: b64url("hi") },
    }, "not-a-number"));
    expect(parsed?.receivedAtMs).toBeGreaterThan(0);
  });
});
