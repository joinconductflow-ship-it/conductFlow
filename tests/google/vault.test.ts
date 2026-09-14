import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { CredentialDecryptionError, sealRefreshToken, openRefreshToken } from "@/lib/google/vault";

const kek = randomBytes(32);
const other = randomBytes(32);
const aad = "org-a:google:sub-123";

describe("sealRefreshToken", () => {
  it("round-trips a refresh token", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    expect(openRefreshToken(sealed, aad, { kek })).toBe("1//refresh-token-value");
  });

  it("never stores the token or the data key in the clear", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    expect(sealed.tokenSealed).not.toContain("refresh-token-value");
    expect(sealed.dekSealed).not.toContain("refresh-token-value");
    expect(sealed.tokenSealed).not.toBe(sealed.dekSealed);
  });

  it("gives two rows different ciphertext for the same token", () => {
    const a = sealRefreshToken("same", aad, { kek });
    const b = sealRefreshToken("same", aad, { kek });
    expect(a.tokenSealed).not.toBe(b.tokenSealed);
    expect(a.dekSealed).not.toBe(b.dekSealed);
  });

  it("refuses a ciphertext lifted into another org's row", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", "org-a:google:sub-123", { kek });
    expect(() => openRefreshToken(sealed, "org-b:google:sub-123", { kek })).toThrow();
  });

it("refuses the wrong key", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    try {
      openRefreshToken(sealed, aad, { kek: other });
      throw new Error("expected credential decryption to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialDecryptionError);
      expect((error as CredentialDecryptionError).cause).toBeInstanceOf(Error);
    }
  });

  it("falls back to the previous key during a rotation", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek: other });
    expect(openRefreshToken(sealed, aad, { kek, previous: other })).toBe("1//refresh-token-value");
  });

  it("rejects a tampered data key", () => {
    const sealed = sealRefreshToken("1//refresh-token-value", aad, { kek });
    const parts = sealed.dekSealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openRefreshToken({ ...sealed, dekSealed: parts.join(".") }, aad, { kek })).toThrow();
  });

  it("names the env var when no key is configured", () => {
    expect(() => sealRefreshToken("x", aad)).toThrow(/DATA_SOURCE_KEK/);
  });
});
