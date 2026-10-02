import { describe, expect, it } from "vitest";

import { executionIdentityForPersistedProvider } from "@/lib/agents/execution-identity";
import { AgentProviderError, type AgentRuntimeProvider } from "@/lib/agents/types";
import { PROVIDER_OUTCOMES, permitsAutomaticResubmission } from "@/lib/ai/provider-outcome";

export const CONTRACT_AGENT_ID = "contract_agent_1";
export const CONTRACT_FINAL_MESSAGE = '{"findings":[]}';

/**
 * Situations every executor adapter must be able to express. A harness builds
 * a provider (with its transport faked) primed for one scenario.
 */
export type AgentRuntimeScenario =
  | { kind: "start_accepted" }
  | { kind: "start_outcome_unknown" }
  | { kind: "observe"; observation: "running" | "awaiting_approval" | "completed" };

export type AgentRuntimeHarness = {
  build(scenario: AgentRuntimeScenario): {
    provider: AgentRuntimeProvider;
    /** Thread id the harness will report for an accepted start. */
    threadId: string;
    /** Number of submit operations that reached the faked transport. */
    submitCount(): number;
  };
};

function startInput() {
  return {
    providerAgentId: CONTRACT_AGENT_ID,
    message: "Review this menu snapshot.",
    idempotencyKey: "contract-idem-1",
  };
}

/**
 * Behaviour every `AgentRuntimeProvider` must share. Run against each real
 * adapter (transport faked) and every fake that stands in for one, so a fake
 * cannot drift from the contract the production code relies on.
 */
export function describeAgentRuntimeContract(label: string, harness: AgentRuntimeHarness) {
  describe(`AgentRuntimeProvider contract: ${label}`, () => {
    it("declares the identity mapped from its persisted provider value", () => {
      const { provider } = harness.build({ kind: "start_accepted" });
      expect(provider.identity).toEqual(executionIdentityForPersistedProvider(provider.kind));
    });

    it("declares only capabilities it implements", () => {
      const { provider } = harness.build({ kind: "start_accepted" });
      const methods = provider as unknown as Record<string, unknown>;
      expect(typeof methods.cancelRun === "function").toBe(provider.capabilities.cancellation !== "none");
      expect(typeof methods.sendMessage === "function").toBe(provider.capabilities.continuation);
    });

    it("returns a provider reference for an accepted start, submitting once", async () => {
      const built = harness.build({ kind: "start_accepted" });
      await expect(built.provider.startRun(startInput())).resolves.toEqual({
        providerThreadId: built.threadId,
      });
      expect(built.submitCount()).toBe(1);
    });

    it("reports a possibly accepted start as submission_unknown, never as retryable", async () => {
      const built = harness.build({ kind: "start_outcome_unknown" });
      const error = await built.provider.startRun(startInput()).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(AgentProviderError);
      const providerError = error as AgentProviderError;
      expect(providerError.outcome).toBe("submission_unknown");
      expect(permitsAutomaticResubmission(providerError.classification)).toBe(false);
      expect(built.submitCount()).toBe(1);
    });

    it.each(["running", "awaiting_approval", "completed"] as const)(
      "normalises a %s observation",
      async (observation) => {
        const built = harness.build({ kind: "observe", observation });
        const result = await built.provider.getRun({ providerThreadId: built.threadId });
        if (observation === "completed") {
          expect(result).toEqual({ state: "completed", finalMessage: CONTRACT_FINAL_MESSAGE });
        } else {
          expect(result).toEqual({ state: observation });
        }
        expect(built.submitCount()).toBe(0);
      },
    );

    it("only produces classified provider errors", async () => {
      const built = harness.build({ kind: "start_outcome_unknown" });
      const error = await built.provider.startRun(startInput()).catch((caught: unknown) => caught);
      expect(PROVIDER_OUTCOMES).toContain((error as AgentProviderError).classification.outcome);
    });
  });
}
