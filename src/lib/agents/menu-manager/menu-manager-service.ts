import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  AgentRunError,
  createAgentRun,
  expireAgentRunIfDue,
  failQueuedAgentRunInTx,
  getAgentRun,
  getLatestAgentRunForSubject,
  loadPinnedRunInput,
  markAgentRunFailed,
  markAgentRunStarted,
  pollAgentRunOnce,
  START_OUTCOME_UNKNOWN_CODE,
  toAgentRunView,
  type AgentRunConfig,
  type AgentRunRecord,
  type AgentRunView,
} from "@/lib/agents/agent-runs";
import { isMenuManagerAvailable, readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import {
  buildAgentExecutionContext,
  type ExecutionContextDenial,
} from "@/lib/agents/execution-context";
import {
  executionIdentityForNative,
  executionIdentityForPersistedProvider,
} from "@/lib/agents/execution-identity";
import {
  CURRENT_MENU_MANAGER_DEFINITION,
  NATIVE_MENU_MANAGER_DEFINITION,
  getMenuManagerDefinition,
  type MenuManagerDefinition,
} from "@/lib/agents/menu-manager/menu-manager-definition";
import { isNativeModelConfigured, readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import { AGENT_TOOLS } from "@/lib/agents/tools/menu-tools";
import {
  getAgentExecutorReadiness,
  reportAgentExecutorReauthRequired,
} from "@/lib/agents/executor-readiness";
import { getAgentRuntimeProvider } from "@/lib/agents/provider-registry";
import { getTenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";
import {
  ACTIVE_AGENT_RUN_STATUSES,
  AgentProviderError,
  type AgentProviderKind,
  type AgentRunStatus,
  type AgentRuntimeProvider,
} from "@/lib/agents/types";
import type { AgentExecutionIdentity } from "@/lib/ai/execution-identity";
import { reserveAiSpend } from "@/lib/ai/spend/spend-admission";
import { readAiSpendPolicy, type AiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { cancelUnclaimedAiJobInTx, enqueueAiJobInTx, getAiJobForRun } from "@/lib/ai/jobs/ai-job-queue";
import { auditActorClassFromStaffRole } from "@/lib/audit/tenant-audit";
import { loadMenuSnapshotForAgent, type MenuSnapshot } from "@/lib/catalogue/menu-snapshot";
import { assertMenuLocationAccess } from "@/lib/catalogue/menus";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import type { EnvSource } from "@/lib/env";
import { assertTenantActive } from "@/lib/tenant/tenant-status";

const CAPABILITY = "menu_manager" as const;
const SUBJECT_TYPE = "menu";

type ServiceOptions = {
  config?: AgentConfig;
  /** Tests inject a fake; production resolves the registered provider. */
  provider?: AgentRuntimeProvider;
  now?: () => Date;
  spendPolicy?: AiSpendPolicy;
  env?: EnvSource;
};

type Caller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

/** Why QOS is not polling an active run right now. */
export type MenuManagerWaitReason = "agent_connection" | "service_unavailable" | "access_changed";

export type MenuManagerRunView = AgentRunView & { waitingOn: MenuManagerWaitReason | null };

export function isActive(status: AgentRunStatus) {
  return (ACTIVE_AGENT_RUN_STATUSES as readonly AgentRunStatus[]).includes(status);
}

function toMenuManagerRunView(
  run: AgentRunRecord,
  waitingOn: MenuManagerWaitReason | null = null,
): MenuManagerRunView {
  return { ...toAgentRunView(run), waitingOn: isActive(run.status) ? waitingOn : null };
}

/**
 * Decided from local state only: no provider construction or credential read.
 * Rebuilds the run's execution context, so a suspended business, a changed
 * binding or the requester losing access stops collection of the reply.
 */
export async function pollingBlockedBy(
  db: DbClient,
  tenantId: string,
  run: AgentRunRecord,
  config: AgentConfig,
): Promise<MenuManagerWaitReason | null> {
  const context = await buildAgentExecutionContext(db, tenantId, run, { config });
  if (!context.ok) {
    return context.reason === "capability_unavailable" ? "service_unavailable" : "access_changed";
  }
  const readiness = await getAgentExecutorReadiness(db, run.provider);
  return readiness.ready ? null : "agent_connection";
}

function requireAvailable(config: AgentConfig) {
  if (!isMenuManagerAvailable(config)) {
    throw new AgentRunError(
      "capability_unavailable",
      "Menu Manager is not available in this environment.",
      404,
    );
  }
}

async function requireEnabledBinding(db: DbClient, tenantId: string) {
  const binding = await withTenantContext(db, tenantId, async (tx) => {
    await assertTenantActive(tx, tenantId);
    return getTenantAgentBinding(tx, tenantId, CAPABILITY);
  });
  if (!binding) {
    throw new AgentRunError(
      "capability_not_configured",
      "Menu Manager has not been set up for this business.",
      409,
    );
  }
  if (!binding.enabled) {
    throw new AgentRunError(
      "capability_disabled",
      "Menu Manager is turned off for this business.",
      409,
    );
  }
  return binding;
}

async function requireReadyExecutor(db: DbClient, provider: AgentProviderKind) {
  const readiness = await getAgentExecutorReadiness(db, provider);
  if (!readiness.ready) {
    throw new AgentRunError(
      "provider_not_connected",
      "The QOS agent service is not connected right now.",
      503,
    );
  }
}

async function requireMenuAccess(db: DbClient, caller: Caller, menuPublicId: string) {
  await withTenantContext(db, caller.tenantId, (tx) =>
    assertMenuLocationAccess(tx, caller.tenantId, caller.membership, menuPublicId),
  );
}

function assertMenuManagerRun(run: AgentRunRecord, menuPublicId?: string) {
  if (
    run.capability !== CAPABILITY ||
    run.subjectType !== SUBJECT_TYPE ||
    (menuPublicId !== undefined && run.subjectPublicId !== menuPublicId)
  ) {
    throw new AgentRunError("run_not_found", "Agent run not found.", 404);
  }
}

export const NOT_SENT_MESSAGES: Record<ExecutionContextDenial, string> = {
  capability_unavailable: "Menu Manager was turned off before this review could be sent.",
  tenant_inactive: "This business is not active, so the review was not sent.",
  binding_changed: "Menu Manager's approval changed before this review could be sent.",
  requester_access_revoked: "The requester's access changed before this review could be sent.",
  subject_unavailable: "The menu is no longer available, so the review was not sent.",
};

export const DEFINITION_UNAVAILABLE_CODE = "definition_unavailable";
export const PINNED_INPUT_INVALID_CODE = "pinned_input_invalid";
export const EXECUTOR_MISMATCH_CODE = "executor_mismatch";
/** A queued_worker run no worker started before it went stale; proven never sent. */
export const NOT_STARTED_IN_TIME_CODE = "not_started_in_time";
export const NOT_STARTED_IN_TIME_MESSAGE = "QOS did not start this review in time. Nothing was sent to the agent service.";
export const MENU_MANAGER_JOB_KIND = "menu_manager.run" as const;

function runConfigFor(definition: MenuManagerDefinition, config: AgentConfig): AgentRunConfig {
  const toolSchemaVersions: Record<string, string> = {};
  for (const name of definition.allowedTools) {
    const tool = AGENT_TOOLS.get(name);
    if (tool) {
      toolSchemaVersions[name] = tool.version;
    }
  }
  return {
    schema: "qos.agent_run_config.v1",
    runTimeoutMs: config.runTimeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    pollLeaseMs: config.pollLeaseMs,
    queuedStaleMs: config.queuedStaleMs,
    outputSchema: definition.outputSchema,
    allowedTools: [...definition.allowedTools],
    toolSchemaVersions,
  };
}

/** Pinned limits; runs created before pinning use the current configuration. */
export function runLimits(run: AgentRunRecord, config: AgentConfig) {
  return run.runConfig ?? runConfigFor(CURRENT_MENU_MANAGER_DEFINITION, config);
}

/** Runs created before pinning carry no identity and are accepted by any provider of their kind. */
export function executorMatches(run: AgentRunRecord, provider: AgentRuntimeProvider) {
  const pinned: AgentExecutionIdentity | null = run.executionIdentity;
  if (!pinned) {
    return provider.kind === run.provider;
  }
  const live = provider.identity;
  return (
    provider.kind === run.provider &&
    live.executorKind === pinned.executorKind &&
    live.executorAdapter === pinned.executorAdapter &&
    live.adapterVersion === pinned.adapterVersion &&
    live.modelProvider === pinned.modelProvider &&
    live.modelId === pinned.modelId
  );
}

/** Rebuilds the request from the run's pinned input and definition, never from live data. */
export async function pinnedRequest(
  db: DbClient,
  tenantId: string,
  run: AgentRunRecord,
): Promise<{ ok: true; message: string } | { ok: false; code: string; message: string }> {
  const definition = getMenuManagerDefinition(run.definitionVersion);
  if (!definition) {
    return {
      ok: false,
      code: DEFINITION_UNAVAILABLE_CODE,
      message: "This version of QOS cannot run the Menu Manager version this review was created for.",
    };
  }
  const input = await loadPinnedRunInput(db, tenantId, run.id);
  if (!input.ok || input.schema !== definition.inputSchema) {
    return {
      ok: false,
      code: PINNED_INPUT_INVALID_CODE,
      message: "QOS could not verify the menu data saved for this review.",
    };
  }
  return { ok: true, message: definition.buildRequest(JSON.parse(input.payload) as MenuSnapshot) };
}

export async function onReauthRequired(
  db: DbClient,
  provider: AgentProviderKind,
  error: AgentProviderError,
) {
  await reportAgentExecutorReauthRequired(db, provider, error.code);
}

/** Reads a reply only against the definition and request facts the run was sent with. */
export function completionInterpreter(run: AgentRunRecord, definition: MenuManagerDefinition) {
  const summary = run.requestSummary;
  const productPublicIds = Array.isArray(summary.productPublicIds)
    ? summary.productPublicIds.filter((id): id is string => typeof id === "string")
    : [];
  const snapshotSha256 = typeof summary.snapshotSha256 === "string" ? summary.snapshotSha256 : null;
  return (finalMessage: string) =>
    definition.interpretReply(finalMessage, {
      menuPublicId: run.subjectPublicId,
      productPublicIds,
      menuVersion: run.subjectVersion,
      snapshotSha256,
    });
}

/**
 * Read-side upkeep for a queued_worker run. Never contacts a provider. A
 * stale run whose job no worker ever claimed is cancelled and failed as
 * never sent; once a worker has claimed it, only the worker decides. A
 * running run is ended at its deadline like an inline run.
 */
async function settleQueuedWorkerRun(
  db: DbClient,
  tenantId: string,
  run: AgentRunRecord,
  limits: AgentRunConfig,
  now: Date,
): Promise<AgentRunRecord> {
  if (run.status === "running") {
    return expireAgentRunIfDue(db, tenantId, run.publicId, { queuedStaleMs: limits.queuedStaleMs, now });
  }
  if (run.status !== "queued" || now.getTime() - Date.parse(run.createdAt) < limits.queuedStaleMs) {
    return run;
  }
  const job = await getAiJobForRun(db, tenantId, { jobKind: MENU_MANAGER_JOB_KIND, agentRunId: run.id });
  if (!job) {
    return run;
  }
  const failed = await withTenantContext(db, tenantId, async (tx) => {
    const cancelled = await cancelUnclaimedAiJobInTx(tx, {
      jobPublicId: job.publicId,
      code: NOT_STARTED_IN_TIME_CODE,
      message: NOT_STARTED_IN_TIME_MESSAGE,
    });
    return cancelled
      ? failQueuedAgentRunInTx(tx, tenantId, run.publicId, {
          code: NOT_STARTED_IN_TIME_CODE,
          message: NOT_STARTED_IN_TIME_MESSAGE,
          now,
        })
      : null;
  });
  return failed ?? (await getAgentRun(db, tenantId, run.publicId));
}

async function askNativeMenuManager(
  db: DbClient,
  caller: Caller,
  input: {
    menuPublicId: string;
    idempotencyKey: string;
    selectedProductPublicIds?: readonly string[];
    acknowledgeUnresolvedRunPublicId?: string;
  },
  options: ServiceOptions & { config: AgentConfig; now: () => Date },
): Promise<{ run: MenuManagerRunView; created: boolean }> {
  const { config, now: clock } = options;
  if (config.menuManagerExecutionMode !== "queued_worker") {
    throw new AgentRunError(
      "native_requires_queued_worker",
      "Native Menu Manager only admits queued_worker runs.",
      409,
    );
  }
  const env = options.env ?? process.env;
  if (!isNativeModelConfigured(env)) {
    throw new AgentRunError(
      "provider_not_connected",
      "The QOS agent service is not connected right now.",
      503,
    );
  }
  const definition = NATIVE_MENU_MANAGER_DEFINITION;
  const model = readNativeModelConfig(env);
  const spendPolicy = options.spendPolicy ?? readAiSpendPolicy(env);

  const built = await loadMenuSnapshotForAgent(
    db,
    caller.tenantId,
    caller.membership,
    input.menuPublicId,
    { selectedProductPublicIds: input.selectedProductPublicIds, at: clock() },
  );

  const requestedBy = {
    subject: caller.subject,
    actorClass: auditActorClassFromStaffRole(caller.membership.role),
  };
  const auditRequestSummary = {
    snapshotSchema: built.snapshot.schema,
    snapshotSha256: built.sha256,
    scope: built.snapshot.scope.mode,
    productCount: built.productPublicIds.length,
    truncated: built.snapshot.scope.truncated,
  };

  const { run, created } = await createAgentRun(db, {
    tenantId: caller.tenantId,
    subject: {
      type: SUBJECT_TYPE,
      publicId: built.snapshot.menu.menuPublicId,
      version: built.snapshot.menu.version,
    },
    requestedBy,
    idempotencyKey: input.idempotencyKey,
    requestSummary: { ...auditRequestSummary, productPublicIds: built.productPublicIds },
    auditRequestSummary,
    acknowledgedUnresolvedRunPublicId: input.acknowledgeUnresolvedRunPublicId,
    pin: {
      definition: { key: definition.key, version: definition.version },
      executionIdentity: executionIdentityForNative({ provider: model.provider, modelId: model.modelId }),
      runConfig: runConfigFor(definition, config),
      input: { schema: built.snapshot.schema, payload: JSON.stringify(built.snapshot) },
    },
    executionMode: "queued_worker",
    onCreated: async (tx, accepted) => {
      await reserveAiSpend(
        tx,
        {
          tenantId: caller.tenantId,
          path: "menu_manager.native",
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
        jobKind: MENU_MANAGER_JOB_KIND,
        agentRunId: accepted.id,
        now: clock(),
      });
    },
    now: clock(),
  });

  return { run: toMenuManagerRunView(run), created };
}

/**
 * Asks the tenant's approved Menu Manager to review a draft menu. Requires the
 * feature, an enabled binding, a connected provider and menu/location access
 * before any menu data is assembled for disclosure. Replaying the same
 * idempotency key returns the original run without contacting the provider.
 * If the menu's previous run ended with an unknown remote outcome, a new run
 * needs `acknowledgeUnresolvedRunPublicId` naming that run.
 */
export async function askMenuManager(
  db: DbClient,
  caller: Caller,
  input: {
    menuPublicId: string;
    idempotencyKey: string;
    selectedProductPublicIds?: readonly string[];
    acknowledgeUnresolvedRunPublicId?: string;
  },
  options: ServiceOptions = {},
): Promise<{ run: MenuManagerRunView; created: boolean }> {
  const config = options.config ?? readAgentConfig();
  const clock = options.now ?? (() => new Date());
  requireAvailable(config);
  if (config.menuManagerExecutor === "native") {
    return askNativeMenuManager(db, caller, input, { ...options, config, now: clock });
  }
  const binding = await requireEnabledBinding(db, caller.tenantId);
  await requireReadyExecutor(db, binding.provider);
  const definition = CURRENT_MENU_MANAGER_DEFINITION;

  const built = await loadMenuSnapshotForAgent(
    db,
    caller.tenantId,
    caller.membership,
    input.menuPublicId,
    { selectedProductPublicIds: input.selectedProductPublicIds, at: clock() },
  );

  const requestedBy = {
    subject: caller.subject,
    actorClass: auditActorClassFromStaffRole(caller.membership.role),
  };
  const auditRequestSummary = {
    snapshotSchema: built.snapshot.schema,
    snapshotSha256: built.sha256,
    scope: built.snapshot.scope.mode,
    productCount: built.productPublicIds.length,
    truncated: built.snapshot.scope.truncated,
  };

  const { run, created } = await createAgentRun(db, {
    tenantId: caller.tenantId,
    binding,
    subject: {
      type: SUBJECT_TYPE,
      publicId: built.snapshot.menu.menuPublicId,
      version: built.snapshot.menu.version,
    },
    requestedBy,
    idempotencyKey: input.idempotencyKey,
    requestSummary: { ...auditRequestSummary, productPublicIds: built.productPublicIds },
    auditRequestSummary,
    acknowledgedUnresolvedRunPublicId: input.acknowledgeUnresolvedRunPublicId,
    pin: {
      definition: { key: definition.key, version: definition.version },
      executionIdentity: executionIdentityForPersistedProvider(binding.provider),
      runConfig: runConfigFor(definition, config),
      input: { schema: built.snapshot.schema, payload: JSON.stringify(built.snapshot) },
    },
    executionMode: config.menuManagerExecutionMode,
    onCreated:
      config.menuManagerExecutionMode === "queued_worker"
        ? async (tx, accepted) => {
            await enqueueAiJobInTx(tx, {
              tenantId: caller.tenantId,
              jobKind: MENU_MANAGER_JOB_KIND,
              agentRunId: accepted.id,
              now: clock(),
            });
          }
        : undefined,
    now: clock(),
  });

  if (!created) {
    assertMenuManagerRun(run, input.menuPublicId);
    return { run: toMenuManagerRunView(run), created: false };
  }
  if (run.executionMode === "queued_worker") {
    return { run: toMenuManagerRunView(run), created: true };
  }

  const notSent = async (code: string, message: string) => {
    const failed = await markAgentRunFailed(db, caller.tenantId, run.publicId, {
      code,
      message,
      now: clock(),
    });
    return { run: toMenuManagerRunView(failed), created: true };
  };

  const request = await pinnedRequest(db, caller.tenantId, run);
  if (!request.ok) {
    return notSent(request.code, request.message);
  }
  const context = await buildAgentExecutionContext(db, caller.tenantId, run, { config });
  if (!context.ok) {
    return notSent(context.reason, NOT_SENT_MESSAGES[context.reason]);
  }

  try {
    const provider = options.provider ?? getAgentRuntimeProvider(binding.provider);
    if (!executorMatches(run, provider)) {
      return notSent(
        EXECUTOR_MISMATCH_CODE,
        "The QOS agent service changed before this review could be sent.",
      );
    }
    const started = await provider.startRun({
      providerAgentId: run.providerAgentId,
      message: request.message,
      idempotencyKey: input.idempotencyKey,
    });
    const running = await markAgentRunStarted(db, caller.tenantId, run.publicId, {
      providerThreadId: started.providerThreadId,
      actor: requestedBy,
      pollIntervalMs: runLimits(run, config).pollIntervalMs,
      now: clock(),
    });
    return { run: toMenuManagerRunView(running), created: true };
  } catch (error) {
    if (!(error instanceof AgentProviderError)) {
      throw error;
    }
    if (error.requiresReauth) {
      await onReauthRequired(db, binding.provider, error);
    }
    const unknown = error.outcome === "submission_unknown";
    const failed = await markAgentRunFailed(db, caller.tenantId, run.publicId, {
      code: unknown ? START_OUTCOME_UNKNOWN_CODE : error.code,
      message: unknown
        ? "QOS could not confirm whether the agent service accepted this review."
        : "The agent service could not start this review.",
      now: clock(),
    });
    return { run: toMenuManagerRunView(failed), created: true };
  }
}

/**
 * Reads a Menu Manager run after re-checking access. An active run past its
 * deadline is ended locally first, whatever the feature or connection state.
 * Otherwise, when polling is possible and due, performs at most one leased
 * provider poll of the run's existing thread.
 */
export async function refreshMenuManagerRun(
  db: DbClient,
  caller: Caller,
  input: { menuPublicId: string; runPublicId: string },
  options: ServiceOptions = {},
): Promise<MenuManagerRunView> {
  await requireMenuAccess(db, caller, input.menuPublicId);
  const found = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuManagerRun(found, input.menuPublicId);

  if (!isActive(found.status)) {
    return toMenuManagerRunView(found);
  }

  const config = options.config ?? readAgentConfig();
  const clock = options.now ?? (() => new Date());
  const limits = runLimits(found, config);
  if (found.executionMode === "queued_worker") {
    // The worker owns provider contact for this run; reads never poll it.
    const settled = await settleQueuedWorkerRun(db, caller.tenantId, found, limits, clock());
    return isActive(settled.status) && settled.status === "running"
      ? toMenuManagerRunView(settled, await pollingBlockedBy(db, caller.tenantId, settled, config))
      : toMenuManagerRunView(settled);
  }
  const run = await expireAgentRunIfDue(db, caller.tenantId, found.publicId, {
    queuedStaleMs: limits.queuedStaleMs,
    now: clock(),
  });
  if (!isActive(run.status)) {
    return toMenuManagerRunView(run);
  }

  const blocked = await pollingBlockedBy(db, caller.tenantId, run, config);
  if (blocked) {
    return toMenuManagerRunView(run, blocked);
  }

  // A reply is only read with the definition the run was sent with. Until a
  // build that has it is deployed, the run waits and its deadline ends it.
  const definition = getMenuManagerDefinition(run.definitionVersion);
  if (!definition) {
    return toMenuManagerRunView(run, "service_unavailable");
  }

  let provider: AgentRuntimeProvider;
  try {
    provider = options.provider ?? getAgentRuntimeProvider(run.provider);
  } catch (error) {
    if (error instanceof AgentProviderError) {
      return toMenuManagerRunView(run, "service_unavailable");
    }
    throw error;
  }
  if (!executorMatches(run, provider)) {
    return toMenuManagerRunView(run, "service_unavailable");
  }

  const polled = await pollAgentRunOnce(db, caller.tenantId, run.publicId, {
    provider,
    owner: `menu-manager:${randomUUID()}`,
    pollIntervalMs: limits.pollIntervalMs,
    leaseMs: limits.pollLeaseMs,
    queuedStaleMs: limits.queuedStaleMs,
    now: clock,
    interpretCompletion: completionInterpreter(run, definition),
    onReauthRequired: (error) => onReauthRequired(db, run.provider, error),
  });

  return toMenuManagerRunView(polled.run, polled.reauthRequired ? "agent_connection" : null);
}

/** Latest run for the menu; an active run past its deadline is ended first. Never polls. */
export async function getLatestMenuManagerRun(
  db: DbClient,
  caller: Caller,
  menuPublicId: string,
  options: Omit<ServiceOptions, "provider"> = {},
): Promise<MenuManagerRunView | null> {
  await requireMenuAccess(db, caller, menuPublicId);
  const latest = await getLatestAgentRunForSubject(db, caller.tenantId, {
    capability: CAPABILITY,
    subjectType: SUBJECT_TYPE,
    subjectPublicId: menuPublicId,
  });
  if (!latest || !isActive(latest.status)) {
    return latest ? toMenuManagerRunView(latest) : null;
  }
  const config = options.config ?? readAgentConfig();
  const now = (options.now ?? (() => new Date()))();
  const run =
    latest.executionMode === "queued_worker"
      ? await settleQueuedWorkerRun(db, caller.tenantId, latest, runLimits(latest, config), now)
      : await expireAgentRunIfDue(db, caller.tenantId, latest.publicId, {
          queuedStaleMs: runLimits(latest, config).queuedStaleMs,
          now,
        });
  if (!isActive(run.status)) {
    return toMenuManagerRunView(run);
  }
  return toMenuManagerRunView(run, await pollingBlockedBy(db, caller.tenantId, run, config));
}
