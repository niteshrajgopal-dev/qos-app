import type { HyperagentToolCaller } from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";
import {
  CONTRACT_FINAL_MESSAGE,
  describeAgentRuntimeContract,
  type AgentRuntimeScenario,
} from "@/lib/agents/testing/agent-runtime-contract";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { AgentProviderError } from "@/lib/agents/types";

const THREAD_ID = "contract_thread_1";

function hyperagentThread(observation: "running" | "awaiting_approval" | "completed") {
  return {
    thread: { id: THREAD_ID },
    messages: [
      { role: "user", content: "Review this menu snapshot." },
      ...(observation === "completed" ? [{ role: "assistant", content: CONTRACT_FINAL_MESSAGE }] : []),
    ],
    isRunning: observation === "running",
    awaitingApproval: observation === "awaiting_approval",
  };
}

describeAgentRuntimeContract("HyperagentProvider (MCP tool caller faked)", {
  build(scenario: AgentRuntimeScenario) {
    let submits = 0;
    const callTool: HyperagentToolCaller = async (name) => {
      if (name === "create_thread") {
        submits += 1;
        // An unreadable submit response: the thread may exist remotely.
        return scenario.kind === "start_accepted" ? { threadId: THREAD_ID } : { unexpected: true };
      }
      if (name === "get_thread" && scenario.kind === "observe") {
        return hyperagentThread(scenario.observation);
      }
      throw new Error(`unscripted ${name}`);
    };
    return {
      provider: new HyperagentProvider(callTool),
      threadId: THREAD_ID,
      submitCount: () => submits,
    };
  },
});

describeAgentRuntimeContract("FakeAgentProvider", {
  build(scenario: AgentRuntimeScenario) {
    const fake = new FakeAgentProvider();
    if (scenario.kind === "start_outcome_unknown") {
      fake.failStartWith(
        new AgentProviderError("provider_request_failed", "Lost response.", {
          outcome: "submission_unknown",
        }),
      );
    }
    if (scenario.kind === "observe") {
      fake.script(
        scenario.observation === "completed"
          ? { state: "completed", finalMessage: CONTRACT_FINAL_MESSAGE }
          : { state: scenario.observation },
      );
    }
    return {
      provider: fake,
      threadId: "thread_fake_1",
      submitCount: () => fake.startCalls.length,
    };
  },
});
