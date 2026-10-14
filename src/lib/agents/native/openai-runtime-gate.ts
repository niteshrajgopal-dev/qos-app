import { createAgentsSdkModel } from "@/lib/agents/native/agents-sdk-model";
import {
  approvedOpenAiModelForTask,
  type OpenAiNativeTask,
} from "@/lib/agents/native/openai-task-allowlist";
import type { NativeModelConfig } from "@/lib/agents/native/native-model-config";
import { OPENAI_API_KEY_ENV_NAME, readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import type { QosModel } from "@/lib/ai/model/qos-model";
import {
  aiSpendReadiness,
  readAiSpendPolicy,
  type AiSpendPath,
  type AiSpendPolicy,
} from "@/lib/ai/spend/spend-policy";
import type { EnvSource } from "@/lib/env";

export type NativeOpenAiGateReason =
  | "mock_dev_only"
  | "missing_api_key"
  | "task_model_not_approved"
  | "spend_policy_unset"
  | "invalid_configuration";

export type NativeOpenAiGateReadiness =
  | {
      ready: true;
      provider: "openai" | "mock";
      task: OpenAiNativeTask;
      modelId: string;
      spendPath: AiSpendPath;
    }
  | { ready: false; reason: NativeOpenAiGateReason; missing: string[] };

const TASK_SPEND_PATH: Record<OpenAiNativeTask, AiSpendPath> = {
  "menu_manager.native": "menu_manager.native",
  "ai_photo.async": "ai_photo.async",
  "catalogue.translation": "catalogue.translation",
};

function missingForReason(
  reason: NativeOpenAiGateReason,
  spendMissing: string[],
): string[] {
  switch (reason) {
    case "missing_api_key":
      return [OPENAI_API_KEY_ENV_NAME];
    case "task_model_not_approved":
      return ["AGENT_OPENAI_TASK_MODEL_ALLOWLIST"];
    case "spend_policy_unset":
      return spendMissing;
    case "mock_dev_only":
      return ["AGENT_NATIVE_MODEL"];
    case "invalid_configuration":
      return ["AGENT_NATIVE_MODEL_PROVIDER", "AGENT_OPENAI_TASK_MODEL_ALLOWLIST", "AGENT_NATIVE_MODEL"];
    default:
      return [];
  }
}

/** Admission-time gate for a single OpenAI-backed native task. */
export function evaluateNativeOpenAiGate(
  task: OpenAiNativeTask,
  source: EnvSource = process.env,
  spendPolicy: AiSpendPolicy = readAiSpendPolicy(source),
): NativeOpenAiGateReadiness {
  const spendPath = TASK_SPEND_PATH[task];
  const spend = aiSpendReadiness(spendPolicy, spendPath, "openai");
  const spendMissing = spend.admissible ? [] : spend.missing;

  try {
    const config = readNativeModelConfig(source);
    if (config.provider === "mock") {
      if (!config.modelId) {
        return {
          ready: false,
          reason: "mock_dev_only",
          missing: missingForReason("mock_dev_only", []),
        };
      }
      if (!spend.admissible) {
        return {
          ready: false,
          reason: "spend_policy_unset",
          missing: missingForReason("spend_policy_unset", spendMissing),
        };
      }
      return { ready: true, provider: "mock", task, modelId: config.modelId, spendPath };
    }

    if (config.provider !== "openai") {
      return {
        ready: false,
        reason: "invalid_configuration",
        missing: missingForReason("invalid_configuration", []),
      };
    }

    const approved = approvedOpenAiModelForTask(task, source);
    if (!approved) {
      return {
        ready: false,
        reason: "task_model_not_approved",
        missing: missingForReason("task_model_not_approved", []),
      };
    }
    if (!config.openAiApiKey) {
      return {
        ready: false,
        reason: "missing_api_key",
        missing: missingForReason("missing_api_key", []),
      };
    }
    if (!spend.admissible) {
      return {
        ready: false,
        reason: "spend_policy_unset",
        missing: missingForReason("spend_policy_unset", spendMissing),
      };
    }
    if (config.modelId !== approved) {
      return {
        ready: false,
        reason: "invalid_configuration",
        missing: ["AGENT_OPENAI_TASK_MODEL_ALLOWLIST", "AGENT_NATIVE_MODEL"],
      };
    }

    return { ready: true, provider: "openai", task, modelId: approved, spendPath };
  } catch {
    return {
      ready: false,
      reason: "invalid_configuration",
      missing: [...spendMissing, ...missingForReason("invalid_configuration", [])],
    };
  }
}

export function createGatedNativeQosModel(
  gate: Extract<NativeOpenAiGateReadiness, { ready: true }>,
  config: NativeModelConfig,
): QosModel {
  if (gate.provider === "mock") {
    throw new Error("Mock models are injected in tests; the worker does not synthesize them.");
  }
  return createAgentsSdkModel({
    ...config,
    modelId: gate.modelId,
    openAiApiKey: config.openAiApiKey,
  });
}

/** Worker entry: returns a model only when the menu_manager.native gate is fully satisfied. */
export function createMenuManagerNativeQosModel(source: EnvSource = process.env): QosModel | undefined {
  const gate = evaluateNativeOpenAiGate("menu_manager.native", source);
  if (!gate.ready || gate.provider !== "openai") {
    return undefined;
  }
  const config = readNativeModelConfig(source);
  return createGatedNativeQosModel(gate, config);
}

/** Worker entry: model for catalogue.translation when the gate is fully satisfied. */
export function createCatalogueTranslationNativeQosModel(
  source: EnvSource = process.env,
): QosModel | undefined {
  const gate = evaluateNativeOpenAiGate("catalogue.translation", source);
  if (!gate.ready || gate.provider !== "openai") {
    return undefined;
  }
  const config = readNativeModelConfig(source);
  return createGatedNativeQosModel(gate, config);
}

/** True when native Menu Manager admission and worker dispatch may use a configured model. */
export function isNativeModelConfigured(source: EnvSource = process.env) {
  try {
    return evaluateNativeOpenAiGate("menu_manager.native", source).ready;
  } catch {
    return false;
  }
}
