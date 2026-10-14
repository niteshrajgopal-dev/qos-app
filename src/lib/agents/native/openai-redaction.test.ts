import { describe, expect, it } from "vitest";

import { redactOpenAiSecrets, redactOpenAiSecretsDeep } from "@/lib/agents/native/openai-redaction";

describe("OpenAI secret redaction", () => {
  it("redacts sk- keys from strings and nested objects", () => {
    const secret = "sk-FIXTURE_test_key_1234567890";
    expect(redactOpenAiSecrets(`failed with ${secret}`)).not.toContain(secret);
    expect(redactOpenAiSecretsDeep({ err: secret, nested: { token: secret } })).toEqual({
      err: "[redacted]",
      nested: { token: "[redacted]" },
    });
  });
});
