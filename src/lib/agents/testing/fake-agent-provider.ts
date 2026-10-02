import { PERSISTED_AGENT_PROVIDER_IDENTITY } from "@/lib/agents/execution-identity";
import { HYPERAGENT_EXECUTOR_CAPABILITIES } from "@/lib/agents/hyperagent/hyperagent-provider";
import type {
  AgentDescriptor,
  AgentRunObservation,
  AgentRuntimeProvider,
  StartAgentRunInput,
} from "@/lib/agents/types";

type ScriptedObservation = AgentRunObservation | Error;

/**
 * Scriptable provider for tests. Each `getRun` call consumes the next
 * scripted observation (the last one repeats). Records every call so tests can
 * assert on how often, and with what, the provider was invoked. It stands in
 * for the Hyperagent adapter, so it declares the same identity and capabilities.
 */
export class FakeAgentProvider implements AgentRuntimeProvider {
  readonly kind = "hyperagent" as const;
  readonly identity = PERSISTED_AGENT_PROVIDER_IDENTITY.hyperagent;
  readonly capabilities = HYPERAGENT_EXECUTOR_CAPABILITIES;
  readonly startCalls: StartAgentRunInput[] = [];
  readonly getRunCalls: string[] = [];
  private observations: ScriptedObservation[] = [{ state: "running" }];
  private threadCounter = 0;
  private startError: Error | null = null;

  constructor(private readonly agents: AgentDescriptor[] = []) {}

  script(...observations: ScriptedObservation[]) {
    this.observations = observations;
    return this;
  }

  failStartWith(error: Error | null) {
    this.startError = error;
    return this;
  }

  async listAgents() {
    return this.agents;
  }

  async startRun(input: StartAgentRunInput) {
    this.startCalls.push(input);
    if (this.startError) {
      throw this.startError;
    }
    this.threadCounter += 1;
    return { providerThreadId: `thread_fake_${this.threadCounter}` };
  }

  async getRun(input: { providerThreadId: string }) {
    this.getRunCalls.push(input.providerThreadId);
    const next =
      this.observations.length > 1 ? this.observations.shift()! : this.observations[0]!;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
