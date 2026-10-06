import type { ModelProvider } from "@/lib/ai/execution-identity";
import type { EnvSource } from "@/lib/env";

export type NativeModelConfig = {
  provider: ModelProvider;
  modelId: string;
  openAiApiKey: string | null;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const APPROVED_MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,64}$/;

export function readNativeModelConfig(source: EnvSource = process.env): NativeModelConfig {
  const provider = (source.AGENT_NATIVE_MODEL_PROVIDER?.trim().toLowerCase() || "openai") as ModelProvider;
  if (provider !== "openai" && provider !== "mock") {
    throw new Error("AGENT_NATIVE_MODEL_PROVIDER must be openai or mock.");
  }
  if (provider === "mock" && source.NODE_ENV === "production") {
    throw new Error("AGENT_NATIVE_MODEL_PROVIDER=mock is for local development only.");
  }

  const modelId = source.AGENT_NATIVE_MODEL?.trim() || DEFAULT_MODEL;
  if (!APPROVED_MODEL_PATTERN.test(modelId)) {
    throw new Error("AGENT_NATIVE_MODEL must be a lowercase model id.");
  }

  return {
    provider,
    modelId,
    openAiApiKey: source.OPENAI_API_KEY?.trim() || null,
  };
}

/** True when a native model call can be made (mock, or OpenAI with a key). */
export function isNativeModelConfigured(source: EnvSource = process.env) {
  try {
    const config = readNativeModelConfig(source);
    return config.provider === "mock" || Boolean(config.openAiApiKey);
  } catch {
    return false;
  }
}
