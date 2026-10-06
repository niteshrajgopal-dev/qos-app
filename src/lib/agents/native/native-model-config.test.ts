import { describe, expect, it } from "vitest";

import { isNativeModelConfigured, readNativeModelConfig } from "@/lib/agents/native/native-model-config";

describe("native model config", () => {
  it("defaults to OpenAI gpt-4.1-mini without a key", () => {
    const config = readNativeModelConfig({});
    expect(config).toEqual({ provider: "openai", modelId: "gpt-4.1-mini", openAiApiKey: null });
    expect(isNativeModelConfigured({})).toBe(false);
  });

  it("is configured for openai when a key is present", () => {
    expect(isNativeModelConfigured({ OPENAI_API_KEY: "sk-test" })).toBe(true);
  });

  it("allows mock locally and refuses it in production", () => {
    expect(readNativeModelConfig({ AGENT_NATIVE_MODEL_PROVIDER: "mock" }).provider).toBe("mock");
    expect(isNativeModelConfigured({ AGENT_NATIVE_MODEL_PROVIDER: "mock" })).toBe(true);
    expect(() =>
      readNativeModelConfig({ AGENT_NATIVE_MODEL_PROVIDER: "mock", NODE_ENV: "production" }),
    ).toThrow("local development only");
  });

  it("rejects an unapproved model id before any network call", () => {
    expect(() => readNativeModelConfig({ AGENT_NATIVE_MODEL: "GPT-4o" })).toThrow("lowercase model id");
    expect(() => readNativeModelConfig({ AGENT_NATIVE_MODEL: "../secret" })).toThrow(
      "lowercase model id",
    );
  });
});
