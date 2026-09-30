import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class AgentCredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCredentialCryptoError";
  }
}

export type AgentCredentialKey = {
  key: Buffer;
  /** Non-reversible identifier used to detect a rotated or wrong key. */
  fingerprint: string;
};

export function parseAgentCredentialKey(encoded: string | null | undefined): AgentCredentialKey {
  if (!encoded?.trim()) {
    throw new AgentCredentialCryptoError(
      "AGENT_CREDENTIAL_ENCRYPTION_KEY is not configured.",
    );
  }

  const key = Buffer.from(encoded.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new AgentCredentialCryptoError(
      "AGENT_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64-encoded.",
    );
  }

  const fingerprint = createHash("sha256")
    .update("qos.agent-credential-key")
    .update(key)
    .digest("hex")
    .slice(0, 16);

  return { key, fingerprint };
}

function associatedData(purpose: string) {
  return Buffer.from(`qos.agent_provider_credentials:${ENVELOPE_VERSION}:${purpose}`, "utf8");
}

/**
 * Encrypts a JSON-serialisable secret. `purpose` (for example the provider
 * name) is bound as associated data so a ciphertext cannot be replayed into a
 * different slot.
 */
export function encryptAgentCredential(
  value: unknown,
  credentialKey: AgentCredentialKey,
  purpose: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, credentialKey.key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(associatedData(purpose));

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    credentialKey.fingerprint,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptAgentCredential<T = unknown>(
  envelope: string,
  credentialKey: AgentCredentialKey,
  purpose: string,
): T {
  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new AgentCredentialCryptoError("Unsupported credential envelope.");
  }

  const [, fingerprint, ivPart, tagPart, ciphertextPart] = parts;
  if (fingerprint !== credentialKey.fingerprint) {
    throw new AgentCredentialCryptoError(
      "Credential was encrypted with a different key.",
    );
  }

  const iv = Buffer.from(ivPart!, "base64url");
  const tag = Buffer.from(tagPart!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new AgentCredentialCryptoError("Malformed credential envelope.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, credentialKey.key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(associatedData(purpose));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    throw new AgentCredentialCryptoError("Credential could not be decrypted.");
  }
}
