import { NextResponse } from "next/server";

import { AgentRunError } from "@/lib/agents/agent-runs";
import { TenantAgentBindingError } from "@/lib/agents/tenant-agent-bindings";
import { AgentProviderError } from "@/lib/agents/types";
import { catalogueErrorResponse } from "@/lib/catalogue/http";

/** Maps agent errors to responses; provider details never reach the browser. */
export function agentErrorResponse(error: unknown) {
  if (error instanceof AgentRunError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.activeRunPublicId ? { activeRunPublicId: error.activeRunPublicId } : {}),
      },
      { status: error.statusCode },
    );
  }

  if (error instanceof TenantAgentBindingError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  if (error instanceof AgentProviderError) {
    return NextResponse.json(
      { error: "The QOS agent service is unavailable right now.", code: "provider_unavailable" },
      { status: 503 },
    );
  }

  return catalogueErrorResponse(error);
}
