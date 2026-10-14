import { describe, expect, it } from "vitest";

import { AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV } from "@/lib/agents/native/openai-task-allowlist";
import { readNativeModelConfig as readConfig } from "@/lib/agents/native/native-model-config";
import { isNativeModelConfigured } from "@/lib/agents/native/openai-runtime-gate";

const FULL_SPEND = {
  AI_SPEND_PLATFORM_CONCURRENCY: "10",
  AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
  AI_SPEND_MENU_MANAGER_NATIVE_ENABLED: "true",
  AI_SPEND_MENU_MANAGER_NATIVE_MAX_UNITS_PER_RUN: "1",
  AI_SPEND_MENU_MANAGER_NATIVE_TENANT_DAILY_UNITS: "10",
  AI_SPEND_MENU_MANAGER_NATIVE_TENANT_MONTHLY_UNITS: "100",
  AI_SPEND_MENU_MANAGER_NATIVE_TENANT_CONCURRENCY: "10",
  AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_DAILY_UNITS: "20",
  AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_MONTHLY_UNITS: "100",
  AI_SPEND_MENU_MANAGER_NATIVE_UNSTARTED_EXPIRY_MS: "600000",
};

describe("native model config", () => {
  it("does not authorize OpenAI without an explicit allowlist and model", () => {
    expect(() => readConfig({})).toThrow("AGENT_OPENAI_TASK_MODEL_ALLOWLIST");
    expect(isNativeModelConfigured({})).toBe(false);
  });

  it("requires AGENT_NATIVE_MODEL to mirror the approved task model", () => {
    expect(() =>
      readConfig({
        OPENAI_API_KEY: "sk-test",
        [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "menu_manager.native=gpt-4.1-mini",
      }),
    ).toThrow("AGENT_NATIVE_MODEL must match");
  });

  it("is configured for openai when key, allowlist, model, and spend policy are set", () => {
    const env = {
      OPENAI_API_KEY: "sk-test",
      AGENT_NATIVE_MODEL: "gpt-4.1-mini",
      [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "menu_manager.native=gpt-4.1-mini",
      ...FULL_SPEND,
    };
    expect(readConfig(env)).toEqual({
      provider: "openai",
      modelId: "gpt-4.1-mini",
      openAiApiKey: "sk-test",
    });
    expect(isNativeModelConfigured(env)).toBe(true);
  });

  it("allows mock locally with an explicit model and refuses it in production", () => {
    const mockEnv = {
      AGENT_NATIVE_MODEL_PROVIDER: "mock",
      AGENT_NATIVE_MODEL: "fake-model",
      NODE_ENV: "test",
      ...FULL_SPEND,
    };
    expect(readConfig(mockEnv).provider).toBe("mock");
    expect(isNativeModelConfigured(mockEnv)).toBe(true);
    expect(() =>
      readConfig({ AGENT_NATIVE_MODEL_PROVIDER: "mock", AGENT_NATIVE_MODEL: "fake-model", NODE_ENV: "production" }),
    ).toThrow("local development only");
  });

  it("rejects an unapproved model id before any network call", () => {
    expect(() => readConfig({ AGENT_NATIVE_MODEL: "GPT-4o" })).toThrow();
    expect(() => readConfig({ AGENT_NATIVE_MODEL: "../secret" })).toThrow();
  });
});
