import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { DbClient } from "@/db/client";
import {
  agentRunCatalogueTranslationDecisions,
  agentRuns,
  aiJobs,
  aiSpendReservations,
  catalogueProductTranslations,
  catalogueProducts,
} from "@/db/schema";
import {
  AgentRunError,
  createAgentRun,
  failQueuedAgentRunInTx,
  getAgentRun,
  type AgentRunConfig,
  type AgentRunRecord,
} from "@/lib/agents/agent-runs";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { executionIdentityForNative } from "@/lib/agents/execution-identity";
import { cancelUnclaimedAiJobInTx, enqueueAiJobInTx } from "@/lib/ai/jobs/ai-job-queue";
import {
  AiSpendAdmissionError,
  releaseUnstartedAiSpend,
  reserveAiSpend,
} from "@/lib/ai/spend/spend-admission";
import { readAiSpendPolicy, type AiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { loadCatalogueProductForMutationInTx } from "@/lib/catalogue/product-mutation-policy";
import { adminReviewRevertSnapshotFromRow } from "@/lib/catalogue/translation-admin-review-snapshot";
import {
  CURRENT_CATALOGUE_TRANSLATION_DEFINITION,
} from "@/lib/catalogue/translation-review/definition";
import { CATALOGUE_TRANSLATION_PROMPT_VERSION } from "@/lib/catalogue/translation-review/prompt";
import type { TranslationRunResult } from "@/lib/catalogue/translation-review/result";
import { TRANSLATION_INPUT_SCHEMA } from "@/lib/catalogue/translation-review/result";
import { sanitizeTranslationSuggestion } from "@/lib/catalogue/translation-review/sanitize";
import type { ProductLocale } from "@/lib/catalogue/validation";
import { readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
  type ActiveStaffMembership,
} from "@/lib/staff/auth";
import { withTenantContext, type TenantDbExecutor } from "@/lib/tenant/context";
import { assertTenantActive } from "@/lib/tenant/tenant-status";

export const CATALOGUE_TRANSLATION_JOB_KIND = "catalogue.translation.run" as const;
const CAPABILITY = "catalogue_translation" as const;
const SUBJECT_TYPE = "product";

export type TranslationSuggestionState =
  | "pending"
  | "accepted"
  | "rejected"
  | "stale"
  | "failed";

export type TranslationReviewRequestSummary = {
  schema: "qos.catalogue_translation_request.v1";
  sourceLocale: ProductLocale;
  targetLocale: ProductLocale;
  sourceTranslationVersion: number;
  targetTranslationVersion: number;
  productVersion: number;
  modelId: string;
  promptVersion: string;
};

export type TranslationReviewView = {
  runPublicId: string;
  status: AgentRunRecord["status"];
  suggestionState: TranslationSuggestionState;
  failureCode: string | null;
  failureMessage: string | null;
  sourceLocale: ProductLocale;
  targetLocale: ProductLocale;
  source: { displayName: string; description: string | null };
  suggestion: { displayName: string; description: string | null } | null;
  editableSuggestion: { displayName: string; description: string | null } | null;
  modelId: string | null;
  promptVersion: string | null;
  sourceTranslationVersion: number;
  targetTranslationVersion: number;
  pinnedSourceTranslationVersion: number;
  pinnedTargetTranslationVersion: number;
  productVersion: number;
  gateReady: boolean;
  gateReason: string | null;
};

type Caller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

export const requestTranslationBodySchema = z.strictObject({
  sourceLocale: z.enum(["en", "ar"]),
  targetLocale: z.enum(["en", "ar"]),
  idempotencyKey: z.string().trim().min(8).max(200),
  acknowledgeUnresolvedRunPublicId: z.string().optional(),
});

export const acceptTranslationBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
  displayName: z.string().trim().min(1).max(500),
  description: z.string().trim().max(4000).nullable(),
  expectedTargetTranslationVersion: z.number().int().positive(),
});

export const rejectTranslationBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
});

export const cancelTranslationBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
});

function runConfigFor(config: AgentConfig): AgentRunConfig {
  const definition = CURRENT_CATALOGUE_TRANSLATION_DEFINITION;
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

function oppositeLocale(locale: ProductLocale): ProductLocale {
  return locale === "en" ? "ar" : "en";
}

function parseRequestSummary(run: AgentRunRecord): TranslationReviewRequestSummary | null {
  const summary = run.requestSummary;
  if (summary.schema !== "qos.catalogue_translation_request.v1") {
    return null;
  }
  if (summary.sourceLocale !== "en" && summary.sourceLocale !== "ar") {
    return null;
  }
  if (summary.targetLocale !== "en" && summary.targetLocale !== "ar") {
    return null;
  }
  return {
    schema: "qos.catalogue_translation_request.v1",
    sourceLocale: summary.sourceLocale,
    targetLocale: summary.targetLocale,
    sourceTranslationVersion: Number(summary.sourceTranslationVersion),
    targetTranslationVersion: Number(summary.targetTranslationVersion),
    productVersion: Number(summary.productVersion),
    modelId: String(summary.modelId ?? ""),
    promptVersion: String(summary.promptVersion ?? ""),
  };
}

function readResult(run: AgentRunRecord): TranslationRunResult | null {
  if (!run.result || run.result.schema !== "qos.catalogue_translation_result.v1") {
    return null;
  }
  const result = run.result as TranslationRunResult;
  if (typeof result.displayName !== "string") {
    return null;
  }
  return result;
}

async function loadProductTranslations(
  tx: TenantDbExecutor,
  tenantId: string,
  productPublicId: string,
) {
  const [product] = await tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);
  if (!product) {
    return null;
  }
  const rows = await tx
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        eq(catalogueProductTranslations.productId, product.id),
      ),
    );
  const byLocale: Partial<Record<ProductLocale, (typeof rows)[number]>> = {};
  for (const row of rows) {
    if (row.locale === "en" || row.locale === "ar") {
      byLocale[row.locale] = row;
    }
  }
  return { product, byLocale };
}

export function computeSuggestionState(input: {
  run: AgentRunRecord;
  summary: TranslationReviewRequestSummary;
  currentSourceVersion: number;
  currentTargetVersion: number;
  decision: "accepted" | "rejected" | null;
}): TranslationSuggestionState {
  if (input.decision === "accepted") {
    return "accepted";
  }
  if (input.decision === "rejected") {
    return "rejected";
  }
  if (input.run.status === "failed") {
    return "failed";
  }
  if (
    input.summary.sourceTranslationVersion !== input.currentSourceVersion ||
    input.summary.targetTranslationVersion !== input.currentTargetVersion
  ) {
    return "stale";
  }
  if (input.run.status === "completed") {
    const result = readResult(input.run);
    if (result) {
      if (
        result.sourceTranslationVersion !== input.currentSourceVersion ||
        result.targetTranslationVersion !== input.currentTargetVersion
      ) {
        return "stale";
      }
    }
    return "pending";
  }
  return "pending";
}

export async function buildTranslationReviewView(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  run: AgentRunRecord,
  env: Record<string, string | undefined> = process.env,
): Promise<TranslationReviewView | null> {
  const summary = parseRequestSummary(run);
  if (!summary || run.subjectPublicId !== productPublicId) {
    return null;
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const loaded = await loadProductTranslations(tx, tenantId, productPublicId);
    if (!loaded) {
      return null;
    }
    const sourceRow = loaded.byLocale[summary.sourceLocale];
    const targetRow = loaded.byLocale[summary.targetLocale];
    if (!sourceRow || !targetRow) {
      return null;
    }

    const [decision] = await tx
      .select()
      .from(agentRunCatalogueTranslationDecisions)
      .where(
        and(
          eq(agentRunCatalogueTranslationDecisions.tenantId, tenantId),
          eq(agentRunCatalogueTranslationDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);

    const gate = evaluateNativeOpenAiGate("catalogue.translation", env, readAiSpendPolicy(env));
    const result = readResult(run);
    const suggestionState = computeSuggestionState({
      run,
      summary,
      currentSourceVersion: sourceRow.translationVersion,
      currentTargetVersion: targetRow.translationVersion,
      decision: (decision?.decision as "accepted" | "rejected" | undefined) ?? null,
    });

    const suggestion =
      result && suggestionState !== "stale" && suggestionState !== "failed"
        ? { displayName: result.displayName, description: result.description }
        : null;

    const editable =
      decision && suggestionState === "accepted"
        ? {
            displayName: decision.displayName,
            description: decision.description,
          }
        : suggestion;

    return {
      runPublicId: run.publicId,
      status: run.status,
      suggestionState,
      failureCode: run.failureCode,
      failureMessage: run.failureMessage,
      sourceLocale: summary.sourceLocale,
      targetLocale: summary.targetLocale,
      source: {
        displayName: sourceRow.displayName,
        description: sourceRow.description,
      },
      suggestion,
      editableSuggestion: editable,
      modelId: summary.modelId || result?.modelId || null,
      promptVersion: summary.promptVersion || result?.promptVersion || null,
      sourceTranslationVersion: sourceRow.translationVersion,
      targetTranslationVersion: targetRow.translationVersion,
      pinnedSourceTranslationVersion: summary.sourceTranslationVersion,
      pinnedTargetTranslationVersion: summary.targetTranslationVersion,
      productVersion: loaded.product.version,
      gateReady: gate.ready,
      gateReason: gate.ready ? null : gate.reason,
    };
  });
}

export async function getLatestTranslationReview(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
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
          eq(agentRuns.subjectPublicId, productPublicId),
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
  return buildTranslationReviewView(db, tenantId, productPublicId, record, env);
}

const TRANSLATION_CANCEL_CODE = "translation_cancelled";
const TRANSLATION_CANCEL_MESSAGE = "Translation request was cancelled.";

export async function requestCatalogueTranslation(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof requestTranslationBodySchema>,
  options: {
    env?: Record<string, string | undefined>;
    config?: AgentConfig;
    spendPolicy?: AiSpendPolicy;
    now?: () => Date;
  } = {},
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
  });

  if (input.sourceLocale === input.targetLocale) {
    throw new AgentRunError(
      "invalid_locales",
      "Source and target languages must differ.",
      400,
    );
  }

  const env = options.env ?? process.env;
  const config = options.config ?? readAgentConfig(env);
  if (!config.enabled) {
    throw new AgentRunError(
      "provider_not_connected",
      "Translation is not available right now.",
      503,
    );
  }

  const spendPolicy = options.spendPolicy ?? readAiSpendPolicy(env);
  const gate = evaluateNativeOpenAiGate("catalogue.translation", env, spendPolicy);
  if (!gate.ready) {
    if (gate.reason === "spend_policy_unset") {
      throw new AiSpendAdmissionError(
        "spend_policy_unset",
        "Translation is not enabled because its spend policy has not been configured.",
        503,
      );
    }
    throw new AgentRunError(
      "provider_not_connected",
      "Translation is not available right now.",
      503,
    );
  }

  const model = readNativeModelConfig(env);
  const definition = CURRENT_CATALOGUE_TRANSLATION_DEFINITION;
  const clock = options.now ?? (() => new Date());

  const snapshot = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    const loaded = await loadProductTranslations(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }
    const sourceRow = loaded.byLocale[input.sourceLocale];
    const targetRow = loaded.byLocale[input.targetLocale];
    if (!sourceRow || !targetRow) {
      throw new AgentRunError("product_not_found", "Product translations are missing.", 404);
    }
    return {
      productVersion: loaded.product.version,
      source: {
        displayName: sourceRow.displayName,
        description: sourceRow.description,
      },
      sourceTranslationVersion: sourceRow.translationVersion,
      targetTranslationVersion: targetRow.translationVersion,
    };
  });

  const pinnedInput = {
    schema: TRANSLATION_INPUT_SCHEMA,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    fields: {
      displayName: snapshot.source.displayName,
      description: snapshot.source.description,
    },
  };

  const requestSummary: TranslationReviewRequestSummary = {
    schema: "qos.catalogue_translation_request.v1",
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    sourceTranslationVersion: snapshot.sourceTranslationVersion,
    targetTranslationVersion: snapshot.targetTranslationVersion,
    productVersion: snapshot.productVersion,
    modelId: gate.modelId,
    promptVersion: CATALOGUE_TRANSLATION_PROMPT_VERSION,
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
      publicId: productPublicId,
      version: snapshot.productVersion,
    },
    requestedBy,
    idempotencyKey: input.idempotencyKey,
    requestSummary,
    auditRequestSummary: {
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      sourceTranslationVersion: snapshot.sourceTranslationVersion,
      targetTranslationVersion: snapshot.targetTranslationVersion,
      modelId: gate.modelId,
      promptVersion: CATALOGUE_TRANSLATION_PROMPT_VERSION,
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
        schema: TRANSLATION_INPUT_SCHEMA,
        payload: JSON.stringify(pinnedInput),
      },
    },
    executionMode: "queued_worker",
    onCreated: async (tx, accepted) => {
      await reserveAiSpend(
        tx,
        {
          tenantId: caller.tenantId,
          path: "catalogue.translation",
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
        jobKind: CATALOGUE_TRANSLATION_JOB_KIND,
        agentRunId: accepted.id,
        now: clock(),
      });
    },
    now: clock(),
  });

  const view = await buildTranslationReviewView(db, caller.tenantId, productPublicId, run, env);
  return { run, created, review: view };
}

function assertTranslationRun(run: AgentRunRecord, productPublicId: string) {
  if (
    run.capability !== CAPABILITY ||
    run.subjectType !== SUBJECT_TYPE ||
    run.subjectPublicId !== productPublicId
  ) {
    throw new AgentRunError("run_not_found", "Translation review not found.", 404);
  }
}

export async function acceptCatalogueTranslation(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof acceptTranslationBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
  });

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertTranslationRun(run, productPublicId);
  const summary = parseRequestSummary(run);
  if (!summary) {
    throw new AgentRunError("run_not_found", "Translation review not found.", 404);
  }
  if (run.status !== "completed") {
    throw new AgentRunError("run_not_completed", "This translation is not ready to accept.", 409);
  }

  const idempotentReplay = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
    const loaded = await loadProductTranslations(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }

    const sourceRow = loaded.byLocale[summary.sourceLocale]!;
    const targetRow = loaded.byLocale[summary.targetLocale]!;

    const [existingDecision] = await tx
      .select({ decision: agentRunCatalogueTranslationDecisions.decision })
      .from(agentRunCatalogueTranslationDecisions)
      .where(
        and(
          eq(agentRunCatalogueTranslationDecisions.tenantId, caller.tenantId),
          eq(agentRunCatalogueTranslationDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);
    if (existingDecision?.decision === "accepted") {
      return true;
    }

    const claimSanitized = sanitizeTranslationSuggestion(
      {
        displayName: sourceRow.displayName,
        description: sourceRow.description,
      },
      { displayName: input.displayName, description: input.description },
    );
    if (!claimSanitized.ok) {
      throw new AgentRunError(claimSanitized.code, claimSanitized.message, 400);
    }

    if (
      summary.sourceTranslationVersion !== sourceRow.translationVersion ||
      summary.targetTranslationVersion !== targetRow.translationVersion
    ) {
      throw new AgentRunError(
        "review_outdated",
        "The product changed since this translation was requested. Request a new translation.",
        409,
      );
    }

    if (targetRow.translationVersion !== input.expectedTargetTranslationVersion) {
      throw new AgentRunError(
        "version_conflict",
        "The target translation was updated elsewhere. Reload and try again.",
        409,
      );
    }

    const result = readResult(run);
    if (
      result &&
      (result.sourceTranslationVersion !== sourceRow.translationVersion ||
        result.targetTranslationVersion !== targetRow.translationVersion)
    ) {
      throw new AgentRunError(
        "review_outdated",
        "This suggestion is stale. Request a new translation.",
        409,
      );
    }

    const [reserved] = await tx
      .insert(agentRunCatalogueTranslationDecisions)
      .values({
        tenantId: caller.tenantId,
        agentRunId: run.id,
        decision: "accepted",
        displayName: claimSanitized.value.displayName,
        description: claimSanitized.value.description,
        decidedBySubject: caller.subject,
      })
      .onConflictDoNothing({
        target: [
          agentRunCatalogueTranslationDecisions.tenantId,
          agentRunCatalogueTranslationDecisions.agentRunId,
        ],
      })
      .returning({ id: agentRunCatalogueTranslationDecisions.id });

    if (!reserved) {
      return true;
    }

    const revertSnapshot = adminReviewRevertSnapshotFromRow(targetRow);

    const [applied] = await tx
      .update(catalogueProductTranslations)
      .set({
        ...revertSnapshot,
        displayName: claimSanitized.value.displayName,
        description: claimSanitized.value.description,
        translationVersion: targetRow.translationVersion + 1,
        approvalStatus: "draft",
        provenance: "ai_generated",
        approvedBySubject: null,
        approvedAt: null,
        approvedTranslationVersion: null,
        approvedSourceTranslationVersion: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, caller.tenantId),
          eq(catalogueProductTranslations.id, targetRow.id),
          eq(catalogueProductTranslations.translationVersion, targetRow.translationVersion),
        ),
      )
      .returning({ id: catalogueProductTranslations.id });

    if (!applied) {
      throw new AgentRunError(
        "version_conflict",
        "The target translation was updated elsewhere. Reload and try again.",
        409,
      );
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.translation.suggestion_accepted",
      entityType: "catalogue_product",
      entityPublicId: productPublicId,
      entityVersion: loaded.product.version + 1,
      changeSummary: {
        runPublicId: run.publicId,
        targetLocale: summary.targetLocale,
        sourceTranslationVersion: summary.sourceTranslationVersion,
        targetTranslationVersion: summary.targetTranslationVersion,
      },
    });

    return false;
  });

  const review = await buildTranslationReviewView(db, caller.tenantId, productPublicId, run);
  return { review, idempotentReplay };
}

export async function rejectCatalogueTranslation(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof rejectTranslationBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
  });

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertTranslationRun(run, productPublicId);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
    const loaded = await loadProductTranslations(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }

    const result = readResult(run);
    const displayName = result?.displayName ?? "—";
    const description = result?.description ?? null;

    await tx
      .insert(agentRunCatalogueTranslationDecisions)
      .values({
        tenantId: caller.tenantId,
        agentRunId: run.id,
        decision: "rejected",
        displayName,
        description,
        decidedBySubject: caller.subject,
      })
      .onConflictDoNothing({
        target: [
          agentRunCatalogueTranslationDecisions.tenantId,
          agentRunCatalogueTranslationDecisions.agentRunId,
        ],
      });

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.translation.suggestion_rejected",
      entityType: "catalogue_product",
      entityPublicId: productPublicId,
      entityVersion: loaded.product.version,
      changeSummary: { runPublicId: run.publicId },
    });
  });

  const review = await buildTranslationReviewView(db, caller.tenantId, productPublicId, run);
  return { review };
}

export async function cancelCatalogueTranslation(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof cancelTranslationBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertTranslationRun(run, productPublicId);

  if (run.status !== "queued") {
    throw new AgentRunError(
      "run_not_cancellable",
      "Only queued translation requests can be cancelled.",
      409,
    );
  }

  const now = new Date();
  const failedRun = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    const loaded = await loadProductTranslations(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }

    const [job] = await tx
      .select({ publicId: aiJobs.publicId })
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.tenantId, caller.tenantId),
          eq(aiJobs.jobKind, CATALOGUE_TRANSLATION_JOB_KIND),
          eq(aiJobs.agentRunId, run.id),
        ),
      )
      .limit(1);
    if (!job) {
      throw new AgentRunError("run_not_cancellable", "Translation job not found.", 409);
    }

    const cancelled = await cancelUnclaimedAiJobInTx(tx, {
      jobPublicId: job.publicId,
      code: TRANSLATION_CANCEL_CODE,
      message: TRANSLATION_CANCEL_MESSAGE,
    });
    if (!cancelled) {
      throw new AgentRunError(
        "run_not_cancellable",
        "This translation is already running and cannot be cancelled.",
        409,
      );
    }

    const failed = await failQueuedAgentRunInTx(tx, caller.tenantId, run.publicId, {
      code: TRANSLATION_CANCEL_CODE,
      message: TRANSLATION_CANCEL_MESSAGE,
      now,
    });
    if (!failed) {
      throw new AgentRunError(
        "run_not_cancellable",
        "Translation request is no longer queued.",
        409,
      );
    }

    const [reservation] = await tx
      .select({ publicId: aiSpendReservations.publicId })
      .from(aiSpendReservations)
      .where(
        and(
          eq(aiSpendReservations.tenantId, caller.tenantId),
          eq(aiSpendReservations.path, "catalogue.translation"),
          eq(aiSpendReservations.subjectType, "agent_run"),
          eq(aiSpendReservations.subjectPublicId, run.publicId),
          eq(aiSpendReservations.state, "reserved"),
          isNull(aiSpendReservations.dispatchedAt),
        ),
      )
      .limit(1);
    if (reservation) {
      await releaseUnstartedAiSpend(tx, {
        tenantId: caller.tenantId,
        reservationPublicId: reservation.publicId,
        now,
      });
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.translation.request_cancelled",
      entityType: "catalogue_product",
      entityPublicId: productPublicId,
      entityVersion: loaded.product.version,
      changeSummary: { runPublicId: run.publicId },
    });

    return failed!;
  });

  const review = await buildTranslationReviewView(db, caller.tenantId, productPublicId, failedRun);
  return { review };
}

export async function resolveCaller(
  db: DbClient,
  tenantId: string,
  subject: string,
): Promise<Caller> {
  const membership = await requireActiveStaffMembership(db, tenantId, subject);
  return { tenantId, subject, membership };
}

export { oppositeLocale };
