import { describe, expect, it } from "vitest";

import { AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV } from "@/lib/agents/native/openai-task-allowlist";
import { createMenuManagerNativeQosModel, evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";

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

const MOCK_READY = {
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  NODE_ENV: "test",
  ...FULL_SPEND,
};

describe("native OpenAI runtime gate", () => {
  it("keeps paid OpenAI off without key, allowlist, and spend policy", () => {
    expect(evaluateNativeOpenAiGate("menu_manager.native", {}, readAiSpendPolicy({}))).toMatchObject({
      ready: false,
    });
    expect(
      evaluateNativeOpenAiGate(
        "menu_manager.native",
        {
          OPENAI_API_KEY: "sk-FIXTURE_key",
          AGENT_NATIVE_MODEL: "gpt-4.1-mini",
          [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "menu_manager.native=gpt-4.1-mini",
        },
        readAiSpendPolicy({}),
      ),
    ).toMatchObject({ ready: false, reason: "spend_policy_unset" });
  });

  it("admits mock only with explicit model and spend policy", () => {
    expect(evaluateNativeOpenAiGate("menu_manager.native", MOCK_READY, readAiSpendPolicy(MOCK_READY))).toEqual({
      ready: true,
      provider: "mock",
      task: "menu_manager.native",
      modelId: "fake-model",
      spendPath: "menu_manager.native",
    });
  });

  it("admits OpenAI only when key, allowlist, AGENT_NATIVE_MODEL, and spend align", () => {
    const env = {
      OPENAI_API_KEY: "sk-FIXTURE_key",
      AGENT_NATIVE_MODEL: "gpt-4.1-mini",
      [AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]: "menu_manager.native=gpt-4.1-mini",
      ...FULL_SPEND,
    };
    expect(evaluateNativeOpenAiGate("menu_manager.native", env, readAiSpendPolicy(env))).toMatchObject({
      ready: true,
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
  });

  it("does not construct a worker model when the gate is closed", () => {
    expect(createMenuManagerNativeQosModel({})).toBeUndefined();
  });
});
