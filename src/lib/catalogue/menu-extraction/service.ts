import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { DbClient } from "@/db/client";
import {
  agentRunCatalogueMenuExtractionDecisions,
  agentRuns,
  catalogueMenuExtractionCandidates,
  type MenuExtractionCandidatePayload,
} from "@/db/schema";
import {
  AgentRunError,
  createAgentRun,
  getAgentRun,
  type AgentRunConfig,
  type AgentRunRecord,
} from "@/lib/agents/agent-runs";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { executionIdentityForNative } from "@/lib/agents/execution-identity";
import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import { enqueueAiJobInTx } from "@/lib/ai/jobs/ai-job-queue";
import { AiSpendAdmissionError, reserveAiSpend } from "@/lib/ai/spend/spend-admission";
import { readAiSpendPolicy, type AiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import {
  applyCatalogueImport,
  previewCatalogueImportFromNormalizedRows,
} from "@/lib/catalogue/catalogue-import";
import { CURRENT_CATALOGUE_MENU_EXTRACTION_DEFINITION } from "@/lib/catalogue/menu-extraction/definition";
import { candidateToImportRow } from "@/lib/catalogue/menu-extraction/import-mapper";
import { MENU_EXTRACTION_INPUT_SCHEMA, MENU_EXTRACTION_RESULT_SCHEMA } from "@/lib/catalogue/menu-extraction/result";
import { MENU_EXTRACTION_PROMPT_VERSION } from "@/lib/catalogue/menu-extraction/prompt";
import { loadMenuExtractionSource } from "@/lib/catalogue/menu-extraction/source-store";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
  type ActiveStaffMembership,
} from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { assertTenantActive } from "@/lib/tenant/tenant-status";

export const CATALOGUE_MENU_EXTRACTION_JOB_KIND = "catalogue.menu_extraction.run" as const;
const CAPABILITY = "catalogue_menu_extraction" as const;
const SUBJECT_TYPE = "menu_extraction_source";

export type MenuExtractionReviewRequestSummary = {
  schema: "qos.catalogue_menu_extraction_request.v1";
  sourcePublicId: string;
  contentHash: string;
  pageCount: number;
  modelId: string;
  promptVersion: string;
};

export type MenuExtractionReviewView = {
  runPublicId: string;
  status: AgentRunRecord["status"];
  failureCode: string | null;
  failureMessage: string | null;
  sourcePublicId: string;
  contentHash: string;
  pageCount: number;
  candidates: Array<{
    candidateKey: string;
    excluded: boolean;
    payload: MenuExtractionCandidatePayload;
  }>;
  gateReady: boolean;
  gateReason: string | null;
  decision: "confirmed" | "rejected" | "cancelled" | null;
  importOperationPublicId: string | null;
};

type Caller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

export const requestMenuExtractionBodySchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(200),
  acknowledgeUnresolvedRunPublicId: z.string().optional(),
});

export const updateMenuExtractionCandidatesBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
  candidates: z
    .array(
      z.strictObject({
        candidateKey: z.string().trim().min(1).max(120),
        excluded: z.boolean(),
        payload: z.custom<MenuExtractionCandidatePayload>(),
      }),
    )
    .max(500),
});

export const confirmMenuExtractionBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
  importIdempotencyKey: z.string().trim().min(8).max(200),
});

export const rejectMenuExtractionBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
});

function runConfigFor(config: AgentConfig): AgentRunConfig {
  const definition = CURRENT_CATALOGUE_MENU_EXTRACTION_DEFINITION;
  return {
    schema: "qos.agent_run_config.v1",
    runTimeoutMs: config.runTimeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    pollLeaseMs: config.pollLeaseMs,
    queuedStaleMs: config.queuedStaleMs,
    outputSchema: definition.outputSchema,
    allowedTools: [...definition.allowedTools],
    toolSchemaVersions: {},
  };
}

function readExtractionResult(run: AgentRunRecord) {
  const output = run.result;
  if (!output || output.schema !== MENU_EXTRACTION_RESULT_SCHEMA) {
    return null;
  }
  return output;
}

export async function buildMenuExtractionReviewView(
  db: DbClient,
  tenantId: string,
  sourcePublicId: string,
  run: AgentRunRecord,
  env: Record<string, string | undefined> = process.env,
): Promise<MenuExtractionReviewView | null> {
  const summary = run.requestSummary as Partial<MenuExtractionReviewRequestSummary>;
  if (summary.schema !== "qos.catalogue_menu_extraction_request.v1") {
    return null;
  }
  if (run.subjectPublicId !== sourcePublicId) {
    return null;
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const candidates = await tx
      .select()
      .from(catalogueMenuExtractionCandidates)
      .where(
        and(
          eq(catalogueMenuExtractionCandidates.tenantId, tenantId),
          eq(catalogueMenuExtractionCandidates.agentRunId, run.id),
        ),
      );

    const [decision] = await tx
      .select()
      .from(agentRunCatalogueMenuExtractionDecisions)
      .where(
        and(
          eq(agentRunCatalogueMenuExtractionDecisions.tenantId, tenantId),
          eq(agentRunCatalogueMenuExtractionDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);

    const gate = evaluateNativeOpenAiGate("catalogue.menu_extraction", env, readAiSpendPolicy(env));

    return {
      runPublicId: run.publicId,
      status: run.status,
      failureCode: run.failureCode,
      failureMessage: run.failureMessage,
      sourcePublicId,
      contentHash: String(summary.contentHash ?? ""),
      pageCount: Number(summary.pageCount ?? 0),
      candidates: candidates.map((row) => ({
        candidateKey: row.candidateKey,
        excluded: row.excluded,
        payload: row.payload,
      })),
      gateReady: gate.ready,
      gateReason: gate.ready ? null : gate.reason,
      decision: (decision?.decision as MenuExtractionReviewView["decision"]) ?? null,
      importOperationPublicId: decision?.importOperationPublicId ?? null,
    };
  });
}

export async function requestMenuExtraction(
  db: DbClient,
  caller: Caller,
  sourcePublicId: string,
  input: z.infer<typeof requestMenuExtractionBodySchema>,
  options: {
    env?: Record<string, string | undefined>;
    config?: AgentConfig;
    spendPolicy?: AiSpendPolicy;
    now?: () => Date;
  } = {},
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  const env = options.env ?? process.env;
  const config = options.config ?? readAgentConfig(env);
  if (!config.enabled) {
    throw new AgentRunError(
      "provider_not_connected",
      "Menu extraction is not available right now.",
      503,
    );
  }

  const spendPolicy = options.spendPolicy ?? readAiSpendPolicy(env);
  const gate = evaluateNativeOpenAiGate("catalogue.menu_extraction", env, spendPolicy);
  if (!gate.ready) {
    if (gate.reason === "spend_policy_unset") {
      throw new AiSpendAdmissionError(
        "spend_policy_unset",
        "Menu extraction is not enabled because its spend policy has not been configured.",
        503,
      );
    }
    throw new AgentRunError(
      "provider_not_connected",
      "Menu extraction is not available right now.",
      503,
    );
  }

  const loaded = await loadMenuExtractionSource(db, caller.tenantId, sourcePublicId);
  if (!loaded || loaded.source.status !== "ready") {
    throw new AgentRunError("source_not_found", "Menu source not found.", 404);
  }

  const model = readNativeModelConfig(env);
  const definition = CURRENT_CATALOGUE_MENU_EXTRACTION_DEFINITION;
  const clock = options.now ?? (() => new Date());

  const pinnedInput = {
    schema: MENU_EXTRACTION_INPUT_SCHEMA,
    sourcePublicId,
    contentHash: loaded.source.contentHash,
    pageCount: loaded.source.pageCount,
    localeHint: "mixed" as const,
  };

  const requestSummary: MenuExtractionReviewRequestSummary = {
    schema: "qos.catalogue_menu_extraction_request.v1",
    sourcePublicId,
    contentHash: loaded.source.contentHash,
    pageCount: loaded.source.pageCount,
    modelId: gate.modelId,
    promptVersion: MENU_EXTRACTION_PROMPT_VERSION,
  };

  const requestedBy = {
    subject: caller.subject,
    actorClass: auditActorClassFromStaffRole(caller.membership.role),
  };

  const { run, created } = await createAgentRun(db, {
    tenantId: caller.tenantId,
    capability: CAPABILITY,
    subject: {
      type: SUBJECT_TYPE,
      publicId: sourcePublicId,
      version: null,
    },
    requestedBy,
    idempotencyKey: input.idempotencyKey,
    requestSummary,
    auditRequestSummary: {
      sourcePublicId,
      contentHash: loaded.source.contentHash,
      modelId: gate.modelId,
      promptVersion: MENU_EXTRACTION_PROMPT_VERSION,
    },
    acknowledgedUnresolvedRunPublicId: input.acknowledgeUnresolvedRunPublicId,
    pin: {
      definition: { key: definition.key, version: definition.version },
      executionIdentity: executionIdentityForNative({
        provider: model.provider,
        modelId: gate.modelId,
      }),
      runConfig: runConfigFor(config),
      input: {
        schema: MENU_EXTRACTION_INPUT_SCHEMA,
        payload: JSON.stringify(pinnedInput),
      },
    },
    executionMode: "queued_worker",
    onCreated: async (tx, accepted) => {
      await reserveAiSpend(
        tx,
        {
          tenantId: caller.tenantId,
          path: "catalogue.menu_extraction",
          provider: "openai",
          subjectType: "agent_run",
          subjectPublicId: accepted.publicId,
          units: 1,
          requestedBy,
        },
        { policy: spendPolicy, now: clock() },
      );
      await enqueueAiJobInTx(tx, {
        tenantId: caller.tenantId,
        jobKind: CATALOGUE_MENU_EXTRACTION_JOB_KIND,
        agentRunId: accepted.id,
        now: clock(),
      });
    },
    now: clock(),
  });

  const review = await buildMenuExtractionReviewView(
    db,
    caller.tenantId,
    sourcePublicId,
    run,
    env,
  );
  return { run, created, review };
}

export async function getMenuExtractionReview(
  db: DbClient,
  tenantId: string,
  staffSubject: string,
  sourcePublicId: string,
  runPublicId: string,
  env?: Record<string, string | undefined>,
) {
  await requireActiveStaffMembership(db, tenantId, staffSubject);
  const run = await getAgentRun(db, tenantId, runPublicId);
  return buildMenuExtractionReviewView(db, tenantId, sourcePublicId, run, env);
}

export async function updateMenuExtractionCandidates(
  db: DbClient,
  caller: Caller,
  sourcePublicId: string,
  input: z.infer<typeof updateMenuExtractionCandidatesBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);
  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuExtractionRun(run, sourcePublicId);
  if (run.status !== "completed") {
    throw new AgentRunError("run_not_ready", "Extraction is not ready for review.", 409);
  }

  return withTenantContext(db, caller.tenantId, async (tx) => {
    const [decision] = await tx
      .select()
      .from(agentRunCatalogueMenuExtractionDecisions)
      .where(
        and(
          eq(agentRunCatalogueMenuExtractionDecisions.tenantId, caller.tenantId),
          eq(agentRunCatalogueMenuExtractionDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);
    if (decision) {
      throw new AgentRunError("run_already_decided", "This extraction review is closed.", 409);
    }

    for (const candidate of input.candidates) {
      if (candidate.payload.schema !== "qos.catalogue_menu_extraction_candidate.v1") {
        throw new AgentRunError("candidate_invalid", "Candidate payload is invalid.", 400);
      }
      if (candidate.payload.amountMinor === 0) {
        throw new AgentRunError("candidate_invalid", "Price must be blank when unknown.", 400);
      }
      await tx
        .update(catalogueMenuExtractionCandidates)
        .set({
          excluded: candidate.excluded,
          payload: candidate.payload,
          sectionName: candidate.payload.sectionName,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueMenuExtractionCandidates.tenantId, caller.tenantId),
            eq(catalogueMenuExtractionCandidates.agentRunId, run.id),
            eq(catalogueMenuExtractionCandidates.candidateKey, candidate.candidateKey),
          ),
        );
    }

    const review = await buildMenuExtractionReviewView(
      db,
      caller.tenantId,
      sourcePublicId,
      run,
    );
    return { review };
  });
}

export async function confirmMenuExtraction(
  db: DbClient,
  caller: Caller,
  sourcePublicId: string,
  input: z.infer<typeof confirmMenuExtractionBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);
  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuExtractionRun(run, sourcePublicId);
  if (run.status !== "completed") {
    throw new AgentRunError("run_not_ready", "Extraction is not ready to confirm.", 409);
  }
  if (!readExtractionResult(run)) {
    throw new AgentRunError("run_not_ready", "Extraction results are missing.", 409);
  }

  const loaded = await loadMenuExtractionSource(db, caller.tenantId, sourcePublicId);
  if (!loaded) {
    throw new AgentRunError("source_not_found", "Menu source not found.", 404);
  }

  const existingDecision = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    const [row] = await tx
      .select()
      .from(agentRunCatalogueMenuExtractionDecisions)
      .where(
        and(
          eq(agentRunCatalogueMenuExtractionDecisions.tenantId, caller.tenantId),
          eq(agentRunCatalogueMenuExtractionDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);
    return row ?? null;
  });
  if (existingDecision?.decision === "confirmed") {
    const view = await buildMenuExtractionReviewView(db, caller.tenantId, sourcePublicId, run);
    return {
      review: view,
      replayed: true,
      importOperationPublicId: existingDecision.importOperationPublicId,
    };
  }
  if (existingDecision) {
    throw new AgentRunError("run_already_decided", "This extraction review is closed.", 409);
  }

  const candidates = await withTenantContext(db, caller.tenantId, async (tx) =>
    tx
      .select()
      .from(catalogueMenuExtractionCandidates)
      .where(
        and(
          eq(catalogueMenuExtractionCandidates.tenantId, caller.tenantId),
          eq(catalogueMenuExtractionCandidates.agentRunId, run.id),
          eq(catalogueMenuExtractionCandidates.excluded, false),
        ),
      ),
  );

  const importRows = [];
  let sourceRow = 1;
  for (const row of candidates) {
    const mapped = candidateToImportRow(sourcePublicId, row.payload, sourceRow);
    if (!mapped) {
      throw new AgentRunError(
        "candidate_incomplete",
        `Candidate ${row.candidateKey} is missing required confirmed fields (names and price).`,
        400,
      );
    }
    importRows.push(mapped);
    sourceRow += 1;
  }

  if (importRows.length === 0) {
    throw new AgentRunError(
      "no_candidates_selected",
      "Select at least one candidate row to import.",
      400,
    );
  }

  const preview = await previewCatalogueImportFromNormalizedRows(
    db,
    caller.tenantId,
    caller.membership,
    caller.subject,
    {
      connectionKey: "catalogue.menu_extraction",
      fileName: loaded.source.fileName,
      fileFingerprint: loaded.source.contentHash,
      idempotencyKey: input.importIdempotencyKey,
      rows: importRows,
    },
  );

  const applied = await applyCatalogueImport(db, caller.tenantId, caller.membership, caller.subject, {
    operationPublicId: preview.operationPublicId,
    previewHash: preview.previewHash,
    idempotencyKey: `${input.importIdempotencyKey}:apply`,
  });

  const review = await withTenantContext(db, caller.tenantId, async (tx) => {
    await tx.insert(agentRunCatalogueMenuExtractionDecisions).values({
      tenantId: caller.tenantId,
      agentRunId: run.id,
      decision: "confirmed",
      importOperationPublicId: applied.operationPublicId,
      decidedBySubject: caller.subject,
    });

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.menu_extraction.confirmed",
      entityType: "catalogue_menu_extraction_source",
      entityPublicId: sourcePublicId,
      changeSummary: {
        runPublicId: run.publicId,
        importOperationPublicId: applied.operationPublicId,
        createCount: applied.report.createCount,
        updateCount: applied.report.updateCount,
      },
    });

    return {
      replayed: false,
      importOperationPublicId: applied.operationPublicId,
      importReport: applied.report,
    };
  });

  const view = await buildMenuExtractionReviewView(db, caller.tenantId, sourcePublicId, run);
  return { review: view, ...review };
}

export async function rejectMenuExtraction(
  db: DbClient,
  caller: Caller,
  sourcePublicId: string,
  input: z.infer<typeof rejectMenuExtractionBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);
  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuExtractionRun(run, sourcePublicId);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(agentRunCatalogueMenuExtractionDecisions)
      .where(
        and(
          eq(agentRunCatalogueMenuExtractionDecisions.tenantId, caller.tenantId),
          eq(agentRunCatalogueMenuExtractionDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);
    if (existing) {
      return;
    }
    await tx.insert(agentRunCatalogueMenuExtractionDecisions).values({
      tenantId: caller.tenantId,
      agentRunId: run.id,
      decision: "rejected",
      decidedBySubject: caller.subject,
    });
    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      entityType: "catalogue_menu_extraction_source",
      entityPublicId: sourcePublicId,
      action: "catalogue.menu_extraction.rejected",
      changeSummary: { runPublicId: run.publicId },
    });
  });

  const review = await buildMenuExtractionReviewView(db, caller.tenantId, sourcePublicId, run);
  return { review };
}

function assertMenuExtractionRun(run: AgentRunRecord, sourcePublicId: string) {
  if (
    run.capability !== CAPABILITY ||
    run.subjectType !== SUBJECT_TYPE ||
    run.subjectPublicId !== sourcePublicId
  ) {
    throw new AgentRunError("run_not_found", "Menu extraction review not found.", 404);
  }
}

export async function getLatestMenuExtractionReview(
  db: DbClient,
  tenantId: string,
  sourcePublicId: string,
  env?: Record<string, string | undefined>,
) {
  const runPublicId = await withTenantContext(db, tenantId, async (tx) => {
    const [run] = await tx
      .select({ publicId: agentRuns.publicId })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.tenantId, tenantId),
          eq(agentRuns.capability, CAPABILITY),
          eq(agentRuns.subjectType, SUBJECT_TYPE),
          eq(agentRuns.subjectPublicId, sourcePublicId),
        ),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);
    return run?.publicId ?? null;
  });
  if (!runPublicId) {
    return null;
  }
  const record = await getAgentRun(db, tenantId, runPublicId);
  return buildMenuExtractionReviewView(db, tenantId, sourcePublicId, record, env);
}
