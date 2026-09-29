import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class StaffMembershipError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "StaffMembershipError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export const STAFF_MEMBERSHIP_REVOCATION_INTERVAL_MS = 0;

export type ActiveStaffMembershipSummary = {
  tenantId: string;
  tenantPublicId: string;
  tenantName: string;
  membershipId: string;
  role: "administrator" | "user";
};

export type TenantStaffMember = {
  membershipId: string;
  email: string;
  role: "administrator" | "user";
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  locations: { publicId: string; name: string }[];
};

export async function listTenantStaffMembers(
  db: DbClient,
  tenantId: string,
): Promise<TenantStaffMember[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const members = await tx
      .select({
        membershipId: staffMemberships.id,
        email: staffIdentities.email,
        role: staffMemberships.role,
        status: staffMemberships.status,
        createdAt: staffMemberships.createdAt,
        updatedAt: staffMemberships.updatedAt,
      })
      .from(staffMemberships)
      .innerJoin(
        staffIdentities,
        eq(staffIdentities.id, staffMemberships.staffIdentityId),
      )
      .where(eq(staffMemberships.tenantId, tenantId))
      .orderBy(asc(staffMemberships.status), desc(staffMemberships.createdAt));

    const scopes = await tx
      .select({
        membershipId: staffLocationScopes.staffMembershipId,
        publicId: locations.publicId,
        name: locations.name,
      })
      .from(staffLocationScopes)
      .innerJoin(
        locations,
        and(
          eq(locations.tenantId, staffLocationScopes.tenantId),
          eq(locations.id, staffLocationScopes.locationId),
        ),
      )
      .where(eq(staffLocationScopes.tenantId, tenantId))
      .orderBy(locations.name);

    const scopesByMembership = new Map<string, { publicId: string; name: string }[]>();
    for (const scope of scopes) {
      const list = scopesByMembership.get(scope.membershipId) ?? [];
      list.push({ publicId: scope.publicId, name: scope.name });
      scopesByMembership.set(scope.membershipId, list);
    }

    return members.map((member) => ({
      ...member,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
      locations: scopesByMembership.get(member.membershipId) ?? [],
    }));
  });
}

export async function revokeStaffMembership(
  db: DbClient,
  tenantId: string,
  membershipId: string,
  actorSubject: string,
  actor: ActiveStaffMembership,
) {
  if (actor.membershipId === membershipId) {
    throw new StaffMembershipError(
      "Administrators cannot revoke their own membership.",
      403,
      "membershipId",
    );
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const [membership] = await tx
      .select({
        id: staffMemberships.id,
        status: staffMemberships.status,
        role: staffMemberships.role,
      })
      .from(staffMemberships)
      .where(
        and(
          eq(staffMemberships.tenantId, tenantId),
          eq(staffMemberships.id, membershipId),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new StaffMembershipError("Staff membership not found.", 404);
    }

    if (membership.status === "revoked") {
      return { membershipId, status: "revoked" as const, idempotentReplay: true };
    }

    await tx
      .update(staffMemberships)
      .set({
        status: "revoked",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(staffMemberships.tenantId, tenantId),
          eq(staffMemberships.id, membershipId),
        ),
      );

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject,
      actorClass: "staff_administrator",
      action: "staff.membership.revoke",
      entityType: "staff_membership",
      entityPublicId: membershipId,
      changeSummary: {
        before: { status: membership.status, role: membership.role },
        after: { status: "revoked", role: membership.role },
      },
    });

    return { membershipId, status: "revoked" as const, idempotentReplay: false };
  });
}

export async function changeStaffMembershipRole(
  db: DbClient,
  tenantId: string,
  membershipId: string,
  role: "administrator" | "user",
  actorSubject: string,
  actor: ActiveStaffMembership,
) {
  if (actor.membershipId === membershipId) {
    throw new StaffMembershipError(
      "Administrators cannot change their own role.",
      403,
      "membershipId",
    );
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const [membership] = await tx
      .select({
        id: staffMemberships.id,
        role: staffMemberships.role,
        status: staffMemberships.status,
      })
      .from(staffMemberships)
      .where(
        and(
          eq(staffMemberships.tenantId, tenantId),
          eq(staffMemberships.id, membershipId),
        ),
      )
      .limit(1);

    if (!membership || membership.status !== "active") {
      throw new StaffMembershipError("Active staff membership not found.", 404);
    }

    if (membership.role === role) {
      return {
        membershipId,
        role,
        idempotentReplay: true,
      };
    }

    await tx
      .update(staffMemberships)
      .set({
        role,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(staffMemberships.tenantId, tenantId),
          eq(staffMemberships.id, membershipId),
        ),
      );

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject,
      actorClass: "staff_administrator",
      action: "staff.membership.role_change",
      entityType: "staff_membership",
      entityPublicId: membershipId,
      changeSummary: {
        before: { role: membership.role },
        after: { role },
      },
    });

    return {
      membershipId,
      role,
      idempotentReplay: false,
    };
  });
}

export async function listActiveStaffMembershipsForSubject(
  db: DbClient,
  providerSubject: string,
): Promise<ActiveStaffMembershipSummary[]> {
  const rows = await db.execute<ActiveStaffMembershipSummary>(sql`
    SELECT
      tenant_id AS "tenantId",
      tenant_public_id AS "tenantPublicId",
      tenant_name AS "tenantName",
      membership_id AS "membershipId",
      role
    FROM qos.list_active_staff_memberships(${providerSubject})
  `);

  return Array.isArray(rows) ? [...rows] : [];
}
