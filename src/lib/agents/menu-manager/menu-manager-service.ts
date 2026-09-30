import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  AgentRunError,
  createAgentRun,
  getAgentRun,
  getLatestAgentRunForSubject,
  markAgentRunFailed,
  markAgentRunStarted,
  pollAgentRunOnce,
  toAgentRunView,
  type AgentRunRecord,
  type AgentRunView,
} from "@/lib/agents/agent-runs";
import { isMenuManagerAvailable, readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { interpretMenuManagerReply } from "@/lib/agents/menu-manager/menu-manager-result";
import { buildMenuManagerRequest } from "@/lib/agents/menu-manager/menu-manager-request";
import {
  getAgentProviderConnectionStatus,
  markAgentProviderConnectionStatus,
} from "@/lib/agents/provider-connections";
import { getAgentRuntimeProvider } from "@/lib/agents/provider-registry";
import { getTenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";
import { AgentProviderError, type AgentRuntimeProvider } from "@/lib/agents/types";
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

async function requireConnectedProvider(db: DbClient) {
  const connection = await getAgentProviderConnectionStatus(db, "hyperagent");
  if (connection.status !== "connected") {
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

async function onReauthRequired(db: DbClient, error: AgentProviderError) {
  await markAgentProviderConnectionStatus(db, "hyperagent", {
    status: "needs_reauth",
    errorCode: error.code,
  });
}

/**
 * Asks the tenant's approved Menu Manager to review a draft menu. Requires the
 * feature, an enabled binding, a connected provider and menu/location access
 * before any menu data is assembled for disclosure. Replaying the same
 * idempotency key returns the original run without contacting the provider.
 */
export async function askMenuManager(
  db: DbClient,
  caller: Caller,
  input: {
    menuPublicId: string;
    idempotencyKey: string;
    selectedProductPublicIds?: readonly string[];
  },
  options: ServiceOptions = {},
): Promise<{ run: AgentRunView; created: boolean }> {
  const config = options.config ?? readAgentConfig();
  const clock = options.now ?? (() => new Date());
  requireAvailable(config);
  const binding = await requireEnabledBinding(db, caller.tenantId);
  await requireConnectedProvider(db);

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
    runTimeoutMs: config.runTimeoutMs,
    now: clock(),
  });

  if (!created) {
    assertMenuManagerRun(run, input.menuPublicId);
    return { run: toAgentRunView(run), created: false };
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
    return { run: toAgentRunView(running), created: true };
  } catch (error) {
    if (!(error instanceof AgentProviderError)) {
      throw error;
    }
    if (error.requiresReauth) {
      await onReauthRequired(db, error);
    }
    const failed = await markAgentRunFailed(db, caller.tenantId, run.publicId, {
      code: error.code,
      message: "The agent service could not start this review.",
      now: clock(),
    });
    return { run: toAgentRunView(failed), created: true };
  }
}

/**
 * Reads a Menu Manager run and, when it is active and due, performs at most one
 * leased provider poll. Access is re-checked on every read.
 */
export async function refreshMenuManagerRun(
  db: DbClient,
  caller: Caller,
  input: { menuPublicId: string; runPublicId: string },
  options: ServiceOptions = {},
): Promise<AgentRunView> {
  await requireMenuAccess(db, caller, input.menuPublicId);
  const run = await getAgentRun(db, caller.tenantId, input.runPublicId);
  assertMenuManagerRun(run, input.menuPublicId);

  if (run.status !== "queued" && run.status !== "running") {
    return toAgentRunView(run);
  }

  const config = options.config ?? readAgentConfig();
  if (!isMenuManagerAvailable(config)) {
    return toAgentRunView(run);
  }

  let provider: AgentRuntimeProvider;
  try {
    provider = options.provider ?? getAgentRuntimeProvider(run.provider);
  } catch (error) {
    if (error instanceof AgentProviderError) {
      return toAgentRunView(run);
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
    now: options.now,
    interpretCompletion: (finalMessage) =>
      interpretMenuManagerReply(finalMessage, {
        menuPublicId: run.subjectPublicId,
        productPublicIds,
        menuVersion: run.subjectVersion,
        snapshotSha256,
      }),
    onReauthRequired: (error) => onReauthRequired(db, error),
  });

  return toAgentRunView(polled.run);
}

export async function getLatestMenuManagerRun(
  db: DbClient,
  caller: Caller,
  menuPublicId: string,
): Promise<AgentRunView | null> {
  await requireMenuAccess(db, caller, menuPublicId);
  const run = await getLatestAgentRunForSubject(db, caller.tenantId, {
    capability: CAPABILITY,
    subjectType: SUBJECT_TYPE,
    subjectPublicId: menuPublicId,
  });
  return run ? toAgentRunView(run) : null;
}
