import type { ModelProvider } from "@/lib/ai/execution-identity";
import type { EnvSource } from "@/lib/env";

import {
  approvedOpenAiModelForTask,
  readOpenAiTaskModelAllowlist,
} from "@/lib/agents/native/openai-task-allowlist";

export type NativeModelConfig = {
  provider: ModelProvider;
  modelId: string;
  openAiApiKey: string | null;
};

const APPROVED_MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,64}$/;

export const OPENAI_API_KEY_ENV_NAME = "OPENAI_API_KEY";

function readMockModelId(source: EnvSource) {
  const modelId = source.AGENT_NATIVE_MODEL?.trim() || "";
  if (!modelId) {
    throw new Error("AGENT_NATIVE_MODEL is required when AGENT_NATIVE_MODEL_PROVIDER=mock.");
  }
  if (!APPROVED_MODEL_PATTERN.test(modelId)) {
    throw new Error("AGENT_NATIVE_MODEL must be a lowercase model id.");
  }
  return modelId;
}

export function readNativeModelConfig(source: EnvSource = process.env): NativeModelConfig {
  const provider = (source.AGENT_NATIVE_MODEL_PROVIDER?.trim().toLowerCase() || "openai") as ModelProvider;
  if (provider !== "openai" && provider !== "mock") {
    throw new Error("AGENT_NATIVE_MODEL_PROVIDER must be openai or mock.");
  }
  if (provider === "mock" && source.NODE_ENV === "production") {
    throw new Error("AGENT_NATIVE_MODEL_PROVIDER=mock is for local development only.");
  }

  if (provider === "mock") {
    return {
      provider,
      modelId: readMockModelId(source),
      openAiApiKey: null,
    };
  }

  // OpenAI: model id must be explicitly approved for menu_manager.native and mirrored in AGENT_NATIVE_MODEL.
  readOpenAiTaskModelAllowlist(source);
  const approved = approvedOpenAiModelForTask("menu_manager.native", source);
  if (!approved) {
    throw new Error("menu_manager.native is not present in AGENT_OPENAI_TASK_MODEL_ALLOWLIST.");
  }
  const configured = source.AGENT_NATIVE_MODEL?.trim() || "";
  if (!configured) {
    throw new Error("AGENT_NATIVE_MODEL must match the approved menu_manager.native model.");
  }
  if (configured !== approved) {
    throw new Error("AGENT_NATIVE_MODEL must match AGENT_OPENAI_TASK_MODEL_ALLOWLIST for menu_manager.native.");
  }
  if (!APPROVED_MODEL_PATTERN.test(configured)) {
    throw new Error("AGENT_NATIVE_MODEL must be a lowercase model id.");
  }

  return {
    provider,
    modelId: configured,
    openAiApiKey: source.OPENAI_API_KEY?.trim() || null,
  };
}
