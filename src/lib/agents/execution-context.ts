import type { DbClient } from "@/db/client";
import type { AgentRunRecord } from "@/lib/agents/agent-runs";
import { isMenuManagerAvailable, type AgentConfig } from "@/lib/agents/config";
import { getTenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";
import type { AgentCapability } from "@/lib/agents/types";
import { auditActorClassFromStaffRole, type AuditActorClass } from "@/lib/audit/tenant-audit";
import { assertMenuLocationAccess, MenuError } from "@/lib/catalogue/menus";
import {
  requireActiveStaffMembership,
  StaffAuthorizationError,
  type ActiveStaffMembership,
} from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { assertTenantActive, TenantInactiveError } from "@/lib/tenant/tenant-status";

/**
 * Trusted context for one step of a run: dispatch, a poll or a tool call.
 * Built by QOS from the persisted run and live state, never from anything the
 * model sends. Its scope is the run's accepted scope; current permissions can
 * only narrow it, so a later role grant never widens an accepted run.
 */
export type AgentExecutionContext = Readonly<{
  tenantId: string;
  run: Readonly<{
    id: string;
    publicId: string;
    capability: AgentCapability;
    correlationId: string;
    definitionVersion: string | null;
  }>;
  requester: Readonly<{
    subject: string;
    actorClass: AuditActorClass;
    membership: ActiveStaffMembership;
  }>;
  scope: Readonly<{
    subjectType: "menu";
    menuPublicId: string;
    acceptedMenuVersion: number | null;
    productPublicIds: readonly string[];
  }>;
  /** Pinned tool name → schema version. Empty for runs that may not call tools. */
  tools: Readonly<Record<string, string>>;
}>;

export type ExecutionContextDenial =
  | "capability_unavailable"
  | "tenant_inactive"
  | "binding_changed"
  | "requester_access_revoked"
  | "subject_unavailable";

export type ExecutionContextResult =
  | { ok: true; context: AgentExecutionContext }
  | { ok: false; reason: ExecutionContextDenial };

function capabilityAvailable(capability: AgentCapability, config: AgentConfig) {
  switch (capability) {
    case "menu_manager":
      return isMenuManagerAvailable(config);
    default:
      return false;
  }
}

function acceptedProductIds(run: AgentRunRecord) {
  const ids = run.requestSummary.productPublicIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function pinnedTools(run: AgentRunRecord): Record<string, string> {
  const config = run.runConfig;
  if (!config) {
    return {};
  }
  const tools: Record<string, string> = {};
  for (const name of config.allowedTools) {
    const version = config.toolSchemaVersions[name];
    if (version) {
      tools[name] = version;
    }
  }
  return tools;
}

/**
 * Rechecks, from live state: the capability kill switch, tenant status, that
 * the run's approved binding is still the enabled binding, the requester's
 * active membership and their access to every location of the subject.
 * Data already sent to a provider cannot be retracted; this stops what follows.
 */
export async function buildAgentExecutionContext(
  db: DbClient,
  tenantId: string,
  run: AgentRunRecord,
  options: { config: AgentConfig },
): Promise<ExecutionContextResult> {
  if (!capabilityAvailable(run.capability, options.config)) {
    return { ok: false, reason: "capability_unavailable" };
  }
  if (run.subjectType !== "menu") {
    return { ok: false, reason: "subject_unavailable" };
  }

  try {
    const binding = await withTenantContext(db, tenantId, async (tx) => {
      await assertTenantActive(tx, tenantId);
      return getTenantAgentBinding(tx, tenantId, run.capability);
    });
    if (
      !binding ||
      !binding.enabled ||
      binding.id !== run.bindingId ||
      binding.provider !== run.provider ||
      binding.providerAgentId !== run.providerAgentId
    ) {
      return { ok: false, reason: "binding_changed" };
    }

    const membership = await requireActiveStaffMembership(db, tenantId, run.requestedBySubject);
    await withTenantContext(db, tenantId, (tx) =>
      assertMenuLocationAccess(tx, tenantId, membership, run.subjectPublicId),
    );

    return {
      ok: true,
      context: Object.freeze({
        tenantId,
        run: Object.freeze({
          id: run.id,
          publicId: run.publicId,
          capability: run.capability,
          correlationId: run.correlationId,
          definitionVersion: run.definitionVersion,
        }),
        requester: Object.freeze({
          subject: run.requestedBySubject,
          actorClass: auditActorClassFromStaffRole(membership.role),
          membership,
        }),
        scope: Object.freeze({
          subjectType: "menu" as const,
          menuPublicId: run.subjectPublicId,
          acceptedMenuVersion: run.subjectVersion,
          productPublicIds: Object.freeze(acceptedProductIds(run)),
        }),
        tools: Object.freeze(pinnedTools(run)),
      }),
    };
  } catch (error) {
    if (error instanceof TenantInactiveError) {
      return { ok: false, reason: "tenant_inactive" };
    }
    if (error instanceof StaffAuthorizationError) {
      return { ok: false, reason: "requester_access_revoked" };
    }
    if (error instanceof MenuError) {
      return { ok: false, reason: error.statusCode === 404 ? "subject_unavailable" : "requester_access_revoked" };
    }
    throw error;
  }
}
