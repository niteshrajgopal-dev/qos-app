import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  AgentRunError,
  createAgentRun,
  expireAgentRunIfDue,
  getAgentRun,
  getLatestAgentRunForSubject,
  markAgentRunFailed,
  markAgentRunStarted,
  pollAgentRunOnce,
  START_OUTCOME_UNKNOWN_CODE,
  toAgentRunView,
  type AgentRunRecord,
  type AgentRunView,
} from "@/lib/agents/agent-runs";
import { isMenuManagerAvailable, readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { interpretMenuManagerReply } from "@/lib/agents/menu-manager/menu-manager-result";
import { buildMenuManagerRequest } from "@/lib/agents/menu-manager/menu-manager-request";
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
import { auditActorClassFromStaffRole } from "@/lib/audit/tenant-audit";
import { loadMenuSnapshotForAgent } from "@/lib/catalogue/menu-snapshot";
import { assertMenuLocationAccess } from "@/lib/catalogue/menus";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

const CAPABILITY = "menu_manager" as const;
const SUBJECT_TYPE = "menu";

type ServiceOptions = {
  config?: AgentConfig;
  /** Tests inject a fake; production resolves the registered provider. */
  provider?: AgentRuntimeProvider;
  now?: () => Date;
};

type Caller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

/** Why QOS is not polling an active run right now. */
export type MenuManagerWaitReason = "agent_connection" | "service_unavailable";

export type MenuManagerRunView = AgentRunView & { waitingOn: MenuManagerWaitReason | null };

function isActive(status: AgentRunStatus) {
  return (ACTIVE_AGENT_RUN_STATUSES as readonly AgentRunStatus[]).includes(status);
}

function toMenuManagerRunView(
  run: AgentRunRecord,
  waitingOn: MenuManagerWaitReason | null = null,
): MenuManagerRunView {
  return { ...toAgentRunView(run), waitingOn: isActive(run.status) ? waitingOn : null };
}

/** Decided from local state only: no provider construction or credential read. */
async function pollingBlockedBy(
  db: DbClient,
  run: AgentRunRecord,
  config: AgentConfig,
): Promise<MenuManagerWaitReason | null> {
  if (!isMenuManagerAvailable(config)) {
    return "service_unavailable";
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
  const binding = await withTenantContext(db, tenantId, (tx) =>
    getTenantAgentBinding(tx, tenantId, CAPABILITY),
  );
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

async function onReauthRequired(
  db: DbClient,
  provider: AgentProviderKind,
  error: AgentProviderError,
) {
  await reportAgentExecutorReauthRequired(db, provider, error.code);
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
  const binding = await requireEnabledBinding(db, caller.tenantId);
  await requireReadyExecutor(db, binding.provider);

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
    runTimeoutMs: config.runTimeoutMs,
    now: clock(),
  });

  if (!created) {
    assertMenuManagerRun(run, input.menuPublicId);
    return { run: toMenuManagerRunView(run), created: false };
  }

  try {
    const provider = options.provider ?? getAgentRuntimeProvider(binding.provider);
    const started = await provider.startRun({
      providerAgentId: run.providerAgentId,
      message: buildMenuManagerRequest(built.snapshot),
      idempotencyKey: input.idempotencyKey,
    });
    const running = await markAgentRunStarted(db, caller.tenantId, run.publicId, {
      providerThreadId: started.providerThreadId,
      actor: requestedBy,
      pollIntervalMs: config.pollIntervalMs,
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
  const run = await expireAgentRunIfDue(db, caller.tenantId, found.publicId, {
    queuedStaleMs: config.queuedStaleMs,
    now: clock(),
  });
  if (!isActive(run.status)) {
    return toMenuManagerRunView(run);
  }

  const blocked = await pollingBlockedBy(db, run, config);
  if (blocked) {
    return toMenuManagerRunView(run, blocked);
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

  const summary = run.requestSummary;
  const productPublicIds = Array.isArray(summary.productPublicIds)
    ? summary.productPublicIds.filter((id): id is string => typeof id === "string")
    : [];
  const snapshotSha256 = typeof summary.snapshotSha256 === "string" ? summary.snapshotSha256 : null;
  const polled = await pollAgentRunOnce(db, caller.tenantId, run.publicId, {
    provider,
    owner: `menu-manager:${randomUUID()}`,
    pollIntervalMs: config.pollIntervalMs,
    leaseMs: config.pollLeaseMs,
    queuedStaleMs: config.queuedStaleMs,
    now: clock,
    interpretCompletion: (finalMessage) =>
      interpretMenuManagerReply(finalMessage, {
        menuPublicId: run.subjectPublicId,
        productPublicIds,
        menuVersion: run.subjectVersion,
        snapshotSha256,
      }),
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
  const run = await expireAgentRunIfDue(db, caller.tenantId, latest.publicId, {
    queuedStaleMs: config.queuedStaleMs,
    now: (options.now ?? (() => new Date()))(),
  });
  if (!isActive(run.status)) {
    return toMenuManagerRunView(run);
  }
  return toMenuManagerRunView(run, await pollingBlockedBy(db, run, config));
}
