import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { tenantAgentBindings } from "@/db/schema";
import { withAgentPlatformAdmin } from "@/lib/agents/db-context";
import type { AgentCapability, AgentProviderKind } from "@/lib/agents/types";
import { recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { requireAdministratorMembership } from "@/lib/staff/auth";
import { withTenantContext, type TenantDbExecutor } from "@/lib/tenant/context";

export type TenantAgentBinding = {
  id: string;
  publicId: string;
  capability: AgentCapability;
  provider: AgentProviderKind;
  providerAgentId: string;
  enabled: boolean;
  version: number;
  approvedAt: string;
};

export class TenantAgentBindingError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "TenantAgentBindingError";
    this.statusCode = statusCode;
  }
}

const PROVIDER_AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function toBinding(row: typeof tenantAgentBindings.$inferSelect): TenantAgentBinding {
  return {
    id: row.id,
    publicId: row.publicId,
    capability: row.capability,
    provider: row.provider,
    providerAgentId: row.providerAgentId,
    enabled: row.enabled,
    version: row.version,
    approvedAt: row.approvedAt.toISOString(),
  };
}

/** Must run inside `withTenantContext`. */
export async function getTenantAgentBinding(
  tx: TenantDbExecutor,
  tenantId: string,
  capability: AgentCapability,
): Promise<TenantAgentBinding | null> {
  const [row] = await tx
    .select()
    .from(tenantAgentBindings)
    .where(
      and(
        eq(tenantAgentBindings.tenantId, tenantId),
        eq(tenantAgentBindings.capability, capability),
      ),
    )
    .limit(1);

  return row ? toBinding(row) : null;
}

/**
 * Platform operator: records the approved provider agent for a tenant
 * capability. A new binding starts disabled; re-approving keeps the tenant's
 * enabled choice.
 */
export async function approveTenantAgentBinding(
  db: DbClient,
  input: {
    tenantId: string;
    capability: AgentCapability;
    provider: AgentProviderKind;
    providerAgentId: string;
    approvedBySubject: string;
  },
): Promise<TenantAgentBinding> {
  if (!PROVIDER_AGENT_ID_PATTERN.test(input.providerAgentId)) {
    throw new TenantAgentBindingError("providerAgentId is not a valid agent id.");
  }

  return withAgentPlatformAdmin(
    db,
    async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(tenantAgentBindings)
        .values({
          tenantId: input.tenantId,
          publicId: `agb_${randomBytes(8).toString("hex")}`,
          capability: input.capability,
          provider: input.provider,
          providerAgentId: input.providerAgentId,
          approvedBySubject: input.approvedBySubject,
          approvedAt: now,
        })
        .onConflictDoUpdate({
          target: [tenantAgentBindings.tenantId, tenantAgentBindings.capability],
          set: {
            provider: input.provider,
            providerAgentId: input.providerAgentId,
            approvedBySubject: input.approvedBySubject,
            approvedAt: now,
            version: sql`${tenantAgentBindings.version} + 1`,
            updatedAt: now,
          },
        })
        .returning();

      await recordTenantAuditEventInTx(tx, {
        tenantId: input.tenantId,
        actorSubject: input.approvedBySubject,
        actorClass: "operator",
        action: "tenant_agent_binding.approved",
        entityType: "tenant_agent_binding",
        entityPublicId: row!.publicId,
        entityVersion: row!.version,
        changeSummary: {
          capability: input.capability,
          provider: input.provider,
          providerAgentId: input.providerAgentId,
        },
      });

      return toBinding(row!);
    },
    { tenantId: input.tenantId },
  );
}

/** Tenant Administrator: enable or disable an already-approved capability. */
export async function setTenantAgentBindingEnabled(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  capability: AgentCapability,
  input: { enabled: boolean; expectedVersion: number },
): Promise<TenantAgentBinding> {
  const membership = await requireAdministratorMembership(db, tenantId, adminSubject);

  return withTenantContext(db, tenantId, async (tx) => {
    const current = await getTenantAgentBinding(tx, tenantId, capability);
    if (!current) {
      throw new TenantAgentBindingError(
        "This capability has not been approved for the business.",
        404,
      );
    }

    if (current.version !== input.expectedVersion) {
      throw new TenantAgentBindingError(
        "The agent setting changed since it was loaded. Reload and try again.",
        409,
      );
    }

    if (current.enabled === input.enabled) {
      return current;
    }

    const [row] = await tx
      .update(tenantAgentBindings)
      .set({
        enabled: input.enabled,
        enabledChangedBySubject: adminSubject,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenantAgentBindings.tenantId, tenantId),
          eq(tenantAgentBindings.id, current.id),
          eq(tenantAgentBindings.version, current.version),
        ),
      )
      .returning();

    if (!row) {
      throw new TenantAgentBindingError(
        "The agent setting changed since it was loaded. Reload and try again.",
        409,
      );
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: adminSubject,
      actorClass: membership.role === "administrator" ? "staff_administrator" : "staff_user",
      action: input.enabled ? "tenant_agent_binding.enabled" : "tenant_agent_binding.disabled",
      entityType: "tenant_agent_binding",
      entityPublicId: row.publicId,
      entityVersion: row.version,
      changeSummary: { capability, enabled: input.enabled },
    });

    return toBinding(row);
  });
}
