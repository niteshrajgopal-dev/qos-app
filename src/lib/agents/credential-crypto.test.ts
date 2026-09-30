import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AgentCredentialCryptoError,
  decryptAgentCredential,
  encryptAgentCredential,
  parseAgentCredentialKey,
} from "@/lib/agents/credential-crypto";

const key = parseAgentCredentialKey(randomBytes(32).toString("base64"));
const secret = { access_token: "at-secret-value", refresh_token: "rt-secret-value" };

describe("agent credential crypto", () => {
  it("round-trips a secret", () => {
    const envelope = encryptAgentCredential(secret, key, "hyperagent");

    expect(decryptAgentCredential(envelope, key, "hyperagent")).toEqual(secret);
  });

  it("never contains the plaintext and uses a fresh IV each time", () => {
    const first = encryptAgentCredential(secret, key, "hyperagent");
    const second = encryptAgentCredential(secret, key, "hyperagent");

    expect(first).not.toContain("at-secret-value");
    expect(first).not.toContain("rt-secret-value");
    expect(first).not.toBe(second);
    expect(first.startsWith(`v1:${key.fingerprint}:`)).toBe(true);
  });

  it("rejects a tampered ciphertext or tag", () => {
    const envelope = encryptAgentCredential(secret, key, "hyperagent");
    const parts = envelope.split(":");
    const flip = (value: string) =>
      (value[0] === "A" ? "B" : "A") + value.slice(1);

    const tamperedCiphertext = [...parts.slice(0, 4), flip(parts[4]!)].join(":");
    const tamperedTag = [...parts.slice(0, 3), flip(parts[3]!), parts[4]].join(":");

    expect(() => decryptAgentCredential(tamperedCiphertext, key, "hyperagent")).toThrow(
      AgentCredentialCryptoError,
    );
    expect(() => decryptAgentCredential(tamperedTag, key, "hyperagent")).toThrow(
      AgentCredentialCryptoError,
    );
  });

  it("binds the ciphertext to its purpose", () => {
    const envelope = encryptAgentCredential(secret, key, "hyperagent");

    expect(() => decryptAgentCredential(envelope, key, "other-provider")).toThrow(
      "Credential could not be decrypted.",
    );
  });

  it("detects a different key before attempting decryption", () => {
    const envelope = encryptAgentCredential(secret, key, "hyperagent");
    const otherKey = parseAgentCredentialKey(randomBytes(32).toString("base64"));

    expect(() => decryptAgentCredential(envelope, otherKey, "hyperagent")).toThrow(
      "Credential was encrypted with a different key.",
    );
  });

  it("fails closed on a missing or wrongly sized key", () => {
    expect(() => parseAgentCredentialKey(undefined)).toThrow("not configured");
    expect(() => parseAgentCredentialKey(randomBytes(16).toString("base64"))).toThrow(
      "32 bytes",
    );
  });

  it("rejects unknown envelope versions", () => {
    expect(() => decryptAgentCredential("v0:abc:def", key, "hyperagent")).toThrow(
      "Unsupported credential envelope.",
    );
  });
});
