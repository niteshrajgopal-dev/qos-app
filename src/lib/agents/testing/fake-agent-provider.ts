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
 * assert on how often, and with what, the provider was invoked.
 */
export class FakeAgentProvider implements AgentRuntimeProvider {
  readonly kind = "hyperagent" as const;
  readonly startCalls: StartAgentRunInput[] = [];
  readonly getRunCalls: string[] = [];
  private observations: ScriptedObservation[] = [{ state: "running" }];
  private threadCounter = 0;

  constructor(private readonly agents: AgentDescriptor[] = []) {}

  script(...observations: ScriptedObservation[]) {
    this.observations = observations;
    return this;
  }

  async listAgents() {
    return this.agents;
  }

  async startRun(input: StartAgentRunInput) {
    this.startCalls.push(input);
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
