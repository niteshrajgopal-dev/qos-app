import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { agentRunCatalogueMenuExtractionDecisions, agentRuns } from "@/db/schema";
import { AgentRunError } from "@/lib/agents/agent-runs";

export function computeMenuExtractionCandidatesRevision(
  candidates: Array<{ updatedAt: Date }>,
): number {
  if (candidates.length === 0) {
    return 0;
  }
  return Math.max(...candidates.map((row) => row.updatedAt.getTime()));
}

export async function lockMenuExtractionRunForUpdate(
  tx: DbClient,
  tenantId: string,
  agentRunId: string,
) {
  const [locked] = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.tenantId, tenantId), eq(agentRuns.id, agentRunId)))
    .for("update")
    .limit(1);
  if (!locked) {
    throw new AgentRunError("run_not_found", "Menu extraction review not found.", 404);
  }
}

export async function readMenuExtractionDecision(
  tx: DbClient,
  tenantId: string,
  agentRunId: string,
) {
  const [row] = await tx
    .select()
    .from(agentRunCatalogueMenuExtractionDecisions)
    .where(
      and(
        eq(agentRunCatalogueMenuExtractionDecisions.tenantId, tenantId),
        eq(agentRunCatalogueMenuExtractionDecisions.agentRunId, agentRunId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function assertMenuExtractionCandidatesRevision(
  actualRevision: number,
  expectedVersion: number,
) {
  if (actualRevision !== expectedVersion) {
    throw new AgentRunError(
      "candidates_stale",
      "The extraction grid changed since it was loaded. Refresh and try again.",
      409,
    );
  }
}

export function menuExtractionConfirmImportIdempotencyKey(runPublicId: string) {
  return `menu-extraction-confirm:${runPublicId}`;
}
