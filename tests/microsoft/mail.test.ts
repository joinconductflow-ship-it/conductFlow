import { describe, it, expect } from "vitest";
import { parseInboundMessage } from "@/lib/microsoft/mail";
import type { GraphMailMessage } from "@/lib/microsoft/graph";

function message(overrides: Partial<GraphMailMessage> = {}): GraphMailMessage {
  return {
    id: "msg-1", receivedDateTime: "2024-01-01T00:00:00Z",
    from: { emailAddress: { name: "Priya Sharma", address: " Priya@Example.com " } },
    subject: "Re: this week", body: { contentType: "text", content: "Send the practice set by Friday." },
    ...overrides,
  };
}

describe("parseInboundMessage", () => {
  it("reads structured sender, subject, timestamp, and plain text", () => {
    expect(parseInboundMessage(message())).toEqual({
      id: "msg-1", fromEmail: "priya@example.com", fromName: "Priya Sharma",
      subject: "Re: this week", receivedAtMs: 1704067200000,
      bodyText: "Send the practice set by Friday.",
    });
  });

  it("strips HTML tags and decodes entities", () => {
    const parsed = parseInboundMessage(message({ body: { contentType: "html",
      content: "<style>hidden</style><script>hidden</script><p>Line one</p><p>Line two &amp; more<br>Thanks</p>" } }));
    expect(parsed?.bodyText).toBe("Line one\n\nLine two & more\nThanks");
  });

  it("keeps plain text and supplies missing subject and name defaults", () => {
    expect(parseInboundMessage(message({ subject: undefined, from: { emailAddress: { address: "priya@example.com" } },
      body: { contentType: "text", content: "  a < b &amp; c  " } }))).toMatchObject({
      fromName: null, subject: "(no subject)", bodyText: "a < b &amp; c",
    });
  });

  it("returns null when there is no sender address", () => {
    expect(parseInboundMessage(message({ from: undefined }))).toBeNull();
    expect(parseInboundMessage(message({ from: { emailAddress: { address: " " } } }))).toBeNull();
  });

  it("returns null when there is no readable body", () => {
    expect(parseInboundMessage(message({ body: undefined }))).toBeNull();
    expect(parseInboundMessage(message({ body: { contentType: "text", content: "  " } }))).toBeNull();
    expect(parseInboundMessage(message({ body: { contentType: "html", content: "<p>&nbsp;</p>" } }))).toBeNull();
  });

  it("falls back to now for an unparseable receivedDateTime", () => {
    expect(parseInboundMessage(message({ receivedDateTime: "invalid" }))?.receivedAtMs).toBeGreaterThan(0);
  });
});
