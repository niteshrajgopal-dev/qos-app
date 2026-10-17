import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { DbClient } from "@/db/client";
import {
  agentRunCatalogueDescriptionDecisions,
  agentRuns,
  catalogueProductTranslations,
  catalogueProducts,
} from "@/db/schema";
import {
  AgentRunError,
  createAgentRun,
  getAgentRun,
  type AgentRunConfig,
  type AgentRunRecord,
} from "@/lib/agents/agent-runs";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import { executionIdentityForNative } from "@/lib/agents/execution-identity";
import { enqueueAiJobInTx } from "@/lib/ai/jobs/ai-job-queue";
import { AiSpendAdmissionError, reserveAiSpend } from "@/lib/ai/spend/spend-admission";
import { readAiSpendPolicy, type AiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { loadCatalogueProductForMutationInTx } from "@/lib/catalogue/product-mutation-policy";
import { CURRENT_CATALOGUE_DESCRIPTION_DEFINITION } from "@/lib/catalogue/description-draft/definition";
import { diffDescriptionLines } from "@/lib/catalogue/description-draft/description-diff";
import { CATALOGUE_DESCRIPTION_PROMPT_VERSION } from "@/lib/catalogue/description-draft/prompt";
import type { DescriptionRunResult } from "@/lib/catalogue/description-draft/result";
import { DESCRIPTION_INPUT_SCHEMA } from "@/lib/catalogue/description-draft/result";
import {
  type DescriptionSourceFacts,
  validateDescriptionSuggestion,
} from "@/lib/catalogue/description-draft/validator";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
  type ActiveStaffMembership,
} from "@/lib/staff/auth";
import { withTenantContext, type TenantDbExecutor } from "@/lib/tenant/context";
import { assertTenantActive } from "@/lib/tenant/tenant-status";

export const CATALOGUE_DESCRIPTION_JOB_KIND = "catalogue.description.run" as const;
const CAPABILITY = "catalogue_description" as const;
const SUBJECT_TYPE = "product";
const EN_LOCALE = "en" as const;

export type DescriptionSuggestionState =
  | "pending"
  | "accepted"
  | "rejected"
  | "stale"
  | "failed";

export type DescriptionReviewRequestSummary = {
  schema: "qos.catalogue_description_request.v1";
  sourceTranslationVersion: number;
  productVersion: number;
  modelId: string;
  promptVersion: string;
};

export type DescriptionReviewView = {
  runPublicId: string;
  status: AgentRunRecord["status"];
  suggestionState: DescriptionSuggestionState;
  failureCode: string | null;
  failureMessage: string | null;
  sourceDescription: string | null;
  suggestion: string | null;
  editableSuggestion: string | null;
  descriptionDiff: ReturnType<typeof diffDescriptionLines>;
  modelId: string | null;
  promptVersion: string | null;
  sourceTranslationVersion: number;
  pinnedSourceTranslationVersion: number;
  productVersion: number;
  gateReady: boolean;
  gateReason: string | null;
  isMockResult: boolean;
};

type Caller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

export const requestDescriptionBodySchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(200),
  acknowledgeUnresolvedRunPublicId: z.string().optional(),
});

export const acceptDescriptionBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
  description: z.string().trim().max(4000).nullable(),
  expectedSourceTranslationVersion: z.number().int().positive(),
});

export const rejectDescriptionBodySchema = z.strictObject({
  runPublicId: z.string().regex(/^run_[a-f0-9]{24}$/),
});

function runConfigFor(config: AgentConfig): AgentRunConfig {
  const definition = CURRENT_CATALOGUE_DESCRIPTION_DEFINITION;
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

function parseRequestSummary(run: AgentRunRecord): DescriptionReviewRequestSummary | null {
  const summary = run.requestSummary;
  if (summary.schema !== "qos.catalogue_description_request.v1") {
    return null;
  }
  return {
    schema: "qos.catalogue_description_request.v1",
    sourceTranslationVersion: Number(summary.sourceTranslationVersion),
    productVersion: Number(summary.productVersion),
    modelId: String(summary.modelId ?? ""),
    promptVersion: String(summary.promptVersion ?? ""),
  };
}

function readResult(run: AgentRunRecord): DescriptionRunResult | null {
  if (!run.result || run.result.schema !== "qos.catalogue_description_result.v1") {
    return null;
  }
  const result = run.result as DescriptionRunResult;
  if (result.description !== null && typeof result.description !== "string") {
    return null;
  }
  return result;
}

async function loadProductEnglishSource(
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
  const [enRow] = await tx
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        eq(catalogueProductTranslations.productId, product.id),
        eq(catalogueProductTranslations.locale, EN_LOCALE),
      ),
    )
    .limit(1);
  if (!enRow) {
    return null;
  }
  const facts: DescriptionSourceFacts = {
    displayName: enRow.displayName,
    description: enRow.description,
    nutritionCalories: product.nutritionCalories,
  };
  return { product, enRow, facts };
}

export function computeDescriptionSuggestionState(input: {
  run: AgentRunRecord;
  summary: DescriptionReviewRequestSummary;
  currentSourceVersion: number;
  decision: "accepted" | "rejected" | null;
}): DescriptionSuggestionState {
  if (input.decision === "accepted") {
    return "accepted";
  }
  if (input.decision === "rejected") {
    return "rejected";
  }
  if (input.run.status === "failed") {
    return "failed";
  }
  if (input.summary.sourceTranslationVersion !== input.currentSourceVersion) {
    return "stale";
  }
  if (input.run.status === "completed") {
    const result = readResult(input.run);
    if (result && result.sourceTranslationVersion !== input.currentSourceVersion) {
      return "stale";
    }
    return "pending";
  }
  return "pending";
}

function isMockEnvironment(env: Record<string, string | undefined>) {
  try {
    return readNativeModelConfig(env).provider === "mock";
  } catch {
    return false;
  }
}

export async function buildDescriptionReviewView(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  run: AgentRunRecord,
  env: Record<string, string | undefined> = process.env,
): Promise<DescriptionReviewView | null> {
  const summary = parseRequestSummary(run);
  if (!summary || run.subjectPublicId !== productPublicId) {
    return null;
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const loaded = await loadProductEnglishSource(tx, tenantId, productPublicId);
    if (!loaded) {
      return null;
    }

    const [decision] = await tx
      .select()
      .from(agentRunCatalogueDescriptionDecisions)
      .where(
        and(
          eq(agentRunCatalogueDescriptionDecisions.tenantId, tenantId),
          eq(agentRunCatalogueDescriptionDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);

    const gate = evaluateNativeOpenAiGate("catalogue.description", env, readAiSpendPolicy(env));
    const result = readResult(run);
    const suggestionState = computeDescriptionSuggestionState({
      run,
      summary,
      currentSourceVersion: loaded.enRow.translationVersion,
      decision: (decision?.decision as "accepted" | "rejected" | undefined) ?? null,
    });

    const suggestion =
      result && suggestionState !== "stale" && suggestionState !== "failed"
        ? result.description
        : null;

    const editable =
      decision && suggestionState === "accepted"
        ? decision.description
        : suggestion;

    const diffBase = loaded.enRow.description;
    const diffTarget = editable ?? suggestion;

    return {
      runPublicId: run.publicId,
      status: run.status,
      suggestionState,
      failureCode: run.failureCode,
      failureMessage: run.failureMessage,
      sourceDescription: loaded.enRow.description,
      suggestion,
      editableSuggestion: editable,
      descriptionDiff: diffDescriptionLines(diffBase, diffTarget),
      modelId: summary.modelId || result?.modelId || null,
      promptVersion: summary.promptVersion || result?.promptVersion || null,
      sourceTranslationVersion: loaded.enRow.translationVersion,
      pinnedSourceTranslationVersion: summary.sourceTranslationVersion,
      productVersion: loaded.product.version,
      gateReady: gate.ready,
      gateReason: gate.ready ? null : gate.reason,
      isMockResult: gate.ready && gate.provider === "mock" && isMockEnvironment(env),
    };
  });
}

export async function getLatestDescriptionReview(
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
  return buildDescriptionReviewView(db, tenantId, productPublicId, record, env);
}

export async function requestCatalogueDescription(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof requestDescriptionBodySchema>,
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

  const env = options.env ?? process.env;
  const config = options.config ?? readAgentConfig(env);
  if (!config.enabled) {
    throw new AgentRunError(
      "provider_not_connected",
      "Description help is not available right now.",
      503,
    );
  }

  const spendPolicy = options.spendPolicy ?? readAiSpendPolicy(env);
  const gate = evaluateNativeOpenAiGate("catalogue.description", env, spendPolicy);
  if (!gate.ready) {
    if (gate.reason === "spend_policy_unset") {
      throw new AiSpendAdmissionError(
        "spend_policy_unset",
        "Description help is not enabled because its spend policy has not been configured.",
        503,
      );
    }
    throw new AgentRunError(
      "provider_not_connected",
      "Description help is not available right now.",
      503,
    );
  }

  const model = readNativeModelConfig(env);
  const definition = CURRENT_CATALOGUE_DESCRIPTION_DEFINITION;
  const clock = options.now ?? (() => new Date());

  const snapshot = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    const loaded = await loadProductEnglishSource(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }
    return {
      productVersion: loaded.product.version,
      facts: loaded.facts,
      sourceTranslationVersion: loaded.enRow.translationVersion,
    };
  });

  const pinnedInput = {
    schema: DESCRIPTION_INPUT_SCHEMA,
    locale: EN_LOCALE,
    displayName: snapshot.facts.displayName,
    description: snapshot.facts.description,
    nutritionCalories: snapshot.facts.nutritionCalories,
  };

  const requestSummary: DescriptionReviewRequestSummary = {
    schema: "qos.catalogue_description_request.v1",
    sourceTranslationVersion: snapshot.sourceTranslationVersion,
    productVersion: snapshot.productVersion,
    modelId: gate.modelId,
    promptVersion: CATALOGUE_DESCRIPTION_PROMPT_VERSION,
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
      sourceTranslationVersion: snapshot.sourceTranslationVersion,
      modelId: gate.modelId,
      promptVersion: CATALOGUE_DESCRIPTION_PROMPT_VERSION,
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
        schema: DESCRIPTION_INPUT_SCHEMA,
        payload: JSON.stringify(pinnedInput),
      },
    },
    executionMode: "queued_worker",
    onCreated: async (tx, accepted) => {
      await reserveAiSpend(
        tx,
        {
          tenantId: caller.tenantId,
          path: "catalogue.description",
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
        jobKind: CATALOGUE_DESCRIPTION_JOB_KIND,
        agentRunId: accepted.id,
        now: clock(),
      });
    },
    now: clock(),
  });

  const view = await buildDescriptionReviewView(db, caller.tenantId, productPublicId, run, env);
  return { run, created, review: view };
}

function assertDescriptionRun(run: AgentRunRecord, productPublicId: string) {
  if (
    run.capability !== CAPABILITY ||
    run.subjectType !== SUBJECT_TYPE ||
    run.subjectPublicId !== productPublicId
  ) {
    throw new AgentRunError("run_not_found", "Description review not found.", 404);
  }
}

export async function acceptCatalogueDescription(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof acceptDescriptionBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
  });

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertDescriptionRun(run, productPublicId);
  const summary = parseRequestSummary(run);
  if (!summary) {
    throw new AgentRunError("run_not_found", "Description review not found.", 404);
  }
  if (run.status !== "completed") {
    throw new AgentRunError("run_not_completed", "This description is not ready to accept.", 409);
  }

  const idempotentReplay = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
    const loaded = await loadProductEnglishSource(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }

    const [existingDecision] = await tx
      .select({ decision: agentRunCatalogueDescriptionDecisions.decision })
      .from(agentRunCatalogueDescriptionDecisions)
      .where(
        and(
          eq(agentRunCatalogueDescriptionDecisions.tenantId, caller.tenantId),
          eq(agentRunCatalogueDescriptionDecisions.agentRunId, run.id),
        ),
      )
      .limit(1);
    if (existingDecision?.decision === "accepted") {
      return true;
    }

    const validated = validateDescriptionSuggestion(loaded.facts, input.description);
    if (!validated.ok) {
      throw new AgentRunError(validated.code, validated.message, 400);
    }

    if (summary.sourceTranslationVersion !== loaded.enRow.translationVersion) {
      throw new AgentRunError(
        "review_outdated",
        "The product changed since this description was requested. Request a new suggestion.",
        409,
      );
    }

    if (loaded.enRow.translationVersion !== input.expectedSourceTranslationVersion) {
      throw new AgentRunError(
        "version_conflict",
        "The English description was updated elsewhere. Reload and try again.",
        409,
      );
    }

    const result = readResult(run);
    if (result && result.sourceTranslationVersion !== loaded.enRow.translationVersion) {
      throw new AgentRunError(
        "review_outdated",
        "This suggestion is stale. Request a new description.",
        409,
      );
    }

    const [reserved] = await tx
      .insert(agentRunCatalogueDescriptionDecisions)
      .values({
        tenantId: caller.tenantId,
        agentRunId: run.id,
        decision: "accepted",
        description: validated.value,
        decidedBySubject: caller.subject,
      })
      .onConflictDoNothing({
        target: [
          agentRunCatalogueDescriptionDecisions.tenantId,
          agentRunCatalogueDescriptionDecisions.agentRunId,
        ],
      })
      .returning({ id: agentRunCatalogueDescriptionDecisions.id });

    if (!reserved) {
      return true;
    }

    const [applied] = await tx
      .update(catalogueProductTranslations)
      .set({
        description: validated.value,
        translationVersion: loaded.enRow.translationVersion + 1,
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
          eq(catalogueProductTranslations.id, loaded.enRow.id),
          eq(catalogueProductTranslations.translationVersion, loaded.enRow.translationVersion),
        ),
      )
      .returning({ id: catalogueProductTranslations.id });

    if (!applied) {
      throw new AgentRunError(
        "version_conflict",
        "The English description was updated elsewhere. Reload and try again.",
        409,
      );
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.description.suggestion_accepted",
      entityType: "catalogue_product",
      entityPublicId: productPublicId,
      entityVersion: loaded.product.version,
      changeSummary: {
        runPublicId: run.publicId,
        sourceTranslationVersion: summary.sourceTranslationVersion,
      },
    });

    return false;
  });

  const review = await buildDescriptionReviewView(db, caller.tenantId, productPublicId, run);
  return { review, idempotentReplay };
}

export async function rejectCatalogueDescription(
  db: DbClient,
  caller: Caller,
  productPublicId: string,
  input: z.infer<typeof rejectDescriptionBodySchema>,
) {
  await requireAdministratorMembership(db, caller.tenantId, caller.subject);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
  });

  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertDescriptionRun(run, productPublicId);

  await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertTenantActive(tx, caller.tenantId);
    await loadCatalogueProductForMutationInTx(tx, caller.tenantId, productPublicId);
    const loaded = await loadProductEnglishSource(tx, caller.tenantId, productPublicId);
    if (!loaded) {
      throw new AgentRunError("product_not_found", "Product not found.", 404);
    }

    const result = readResult(run);
    const description = result?.description ?? null;

    await tx
      .insert(agentRunCatalogueDescriptionDecisions)
      .values({
        tenantId: caller.tenantId,
        agentRunId: run.id,
        decision: "rejected",
        description,
        decidedBySubject: caller.subject,
      })
      .onConflictDoNothing({
        target: [
          agentRunCatalogueDescriptionDecisions.tenantId,
          agentRunCatalogueDescriptionDecisions.agentRunId,
        ],
      });

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.description.suggestion_rejected",
      entityType: "catalogue_product",
      entityPublicId: productPublicId,
      entityVersion: loaded.product.version,
      changeSummary: { runPublicId: run.publicId },
    });
  });

  const review = await buildDescriptionReviewView(db, caller.tenantId, productPublicId, run);
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
