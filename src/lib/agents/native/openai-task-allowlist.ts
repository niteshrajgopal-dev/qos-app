import type { EnvSource } from "@/lib/env";

/** Paid OpenAI work is keyed by spend path / task id (not tenant-supplied labels). */
export const OPENAI_NATIVE_TASKS = ["menu_manager.native", "ai_photo.async"] as const;
export type OpenAiNativeTask = (typeof OPENAI_NATIVE_TASKS)[number];

export const AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV = "AGENT_OPENAI_TASK_MODEL_ALLOWLIST";

const APPROVED_MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,64}$/;

function isOpenAiNativeTask(value: string): value is OpenAiNativeTask {
  return (OPENAI_NATIVE_TASKS as readonly string[]).includes(value);
}

/**
 * Explicit operator-approved model per task. No defaults: an empty or missing
 * allowlist means no paid OpenAI task is authorized.
 */
export function readOpenAiTaskModelAllowlist(source: EnvSource = process.env): Map<OpenAiNativeTask, string> {
  const raw = source[AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV]?.trim();
  if (!raw) {
    return new Map();
  }

  const allowlist = new Map<OpenAiNativeTask, string>();
  for (const entry of raw.split(",")) {
    const piece = entry.trim();
    if (!piece) {
      continue;
    }
    const separator = piece.indexOf("=");
    if (separator <= 0) {
      throw new Error(`${AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV} entries must be task=model.`);
    }
    const task = piece.slice(0, separator).trim();
    const modelId = piece.slice(separator + 1).trim();
    if (!isOpenAiNativeTask(task)) {
      throw new Error(`${AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV} contains an unsupported task.`);
    }
    if (!APPROVED_MODEL_PATTERN.test(modelId)) {
      throw new Error(`${AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV} model ids must be lowercase.`);
    }
    if (allowlist.has(task)) {
      throw new Error(`${AGENT_OPENAI_TASK_MODEL_ALLOWLIST_ENV} lists ${task} more than once.`);
    }
    allowlist.set(task, modelId);
  }
  return allowlist;
}

export function approvedOpenAiModelForTask(
  task: OpenAiNativeTask,
  source: EnvSource = process.env,
): string | null {
  return readOpenAiTaskModelAllowlist(source).get(task) ?? null;
}
