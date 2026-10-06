export type QosModelRequest = {
  modelId: string;
  instructions: string;
  input: string;
  tools: ReadonlyArray<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  toolResults?: ReadonlyArray<{ callId: string; output: unknown }>;
};

export type QosModelToolCall = {
  callId: string;
  name: string;
  input: unknown;
};

export type QosModelResult =
  | { type: "completed"; text: string; usage: Record<string, number> | null }
  | { type: "tool_calls"; calls: readonly QosModelToolCall[]; usage: Record<string, number> | null };

/**
 * QOS-owned model boundary. Adapter SDKs implement this; Menu Manager and the
 * native loop never import a vendor client.
 */
export type QosModel = {
  readonly provider: "openai" | "mock";
  readonly modelId: string;
  complete(request: QosModelRequest): Promise<QosModelResult>;
};
