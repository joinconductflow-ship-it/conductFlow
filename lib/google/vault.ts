import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "@/lib/crypto/tokens";

export interface SealedToken {
  tokenSealed: string;
  dekSealed: string;
  kekVersion: number;
}

export interface VaultKeys {
  /** Current KEK. Omit to read DATA_SOURCE_KEK from the environment. */
  kek?: Buffer;
  /** Outgoing KEK during a rotation window. Omit to read DATA_SOURCE_KEK_PREVIOUS. */
  previous?: Buffer;
}

/** The stored credential cannot be opened with the configured key material. */
export class CredentialDecryptionError extends Error {
  constructor(
    message = "Stored refresh token could not be decrypted with any configured key.",
    cause?: unknown,
  ) {
    super(message);
    this.name = "CredentialDecryptionError";
    if (cause !== undefined) this.cause = cause;
  }
}

const KEY_BYTES = 32;

function envKey(name: string): Buffer | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES)
    throw new Error(`${name} must decode to ${KEY_BYTES} bytes, got ${decoded.length}.`);
  return decoded;
}

function currentKek(keys?: VaultKeys): Buffer {
  const kek = keys?.kek ?? envKey("DATA_SOURCE_KEK");
  // An unconfigured deployment loses Google features and keeps everything else. It never
  // falls back to storing plaintext.
  if (!kek) throw new Error("DATA_SOURCE_KEK is not set. It must be a base64-encoded 32-byte key.");
  return kek;
}

/**
 * Envelope encryption: a per-row data key encrypts the refresh token, and the KEK wraps
 * that data key. Rotation then rewraps 32 bytes per row instead of touching token
 * plaintext at all.
 *
 * `aad` binds both layers to the row that owns them — pass `${orgId}:${provider}:${externalAccountId}`.
 */
export function sealRefreshToken(
  refreshToken: string, aad: string, keys?: VaultKeys,
): SealedToken {
  const kek = currentKek(keys);
  const dek = randomBytes(KEY_BYTES);
  return {
    tokenSealed: encryptToken(refreshToken, dek, aad),
    dekSealed: encryptToken(dek.toString("base64"), kek, aad),
    kekVersion: 1,
  };
}

/**
 * Tries the current KEK, then the previous one, so a partially rewrapped table keeps
 * working through a rotation.
 */
export function openRefreshToken(
  sealed: Pick<SealedToken, "tokenSealed" | "dekSealed">, aad: string, keys?: VaultKeys,
): string {
  const candidates = [currentKek(keys), keys?.previous ?? envKey("DATA_SOURCE_KEK_PREVIOUS")]
    .filter((k): k is Buffer => !!k);
  let lastError: unknown;

  for (const kek of candidates) {
    let dek: Buffer;
    try {
      dek = Buffer.from(decryptToken(sealed.dekSealed, kek, aad), "base64");
    } catch (error) {
      lastError = error;
      continue; // Wrong KEK for this row; try the outgoing one.
    }
    try {
      return decryptToken(sealed.tokenSealed, dek, aad);
    } catch (error) {
      lastError = error;
      // A successfully unwrapped DEK with an unreadable token is just as unusable as a
      // key mismatch. Try another configured KEK before reporting a reconnect state.
      continue;
    }
  }
  throw new CredentialDecryptionError(undefined, lastError);
}
