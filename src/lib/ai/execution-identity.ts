/**
 * Who executed an AI run, kept apart from which model served it. Replacing the
 * model provider must not require replacing the executor, and vice versa.
 *
 * - `native`: QOS runs the agent loop in its own process.
 * - `external`: a remote runtime runs the loop; QOS submits and observes.
 */
export type ExecutorKind = "native" | "external";

/**
 * The adapter that drives execution. The native Agents SDK adapter is added
 * with the native executor, not before it exists.
 */
export type ExecutorAdapter = "hyperagent";

export type ModelProvider = "openai" | "mock";

export type AgentExecutionIdentity = {
  executorKind: ExecutorKind;
  executorAdapter: ExecutorAdapter;
  /** Implementation/configuration version of the adapter. */
  adapterVersion: string;
  /** Null when an external runtime does not disclose it. Never guessed. */
  modelProvider: ModelProvider | null;
  /** Null when an external runtime does not disclose it. Never guessed. */
  modelId: string | null;
};
