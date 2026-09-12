import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { staffIdentities, staffMemberships, tenants } from "@/db/schema";
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

export async function revokeStaffMembership(
  db: DbClient,
  tenantId: string,
  membershipId: string,
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

    return { membershipId, status: "revoked" as const, idempotentReplay: false };
  });
}

export async function changeStaffMembershipRole(
  db: DbClient,
  tenantId: string,
  membershipId: string,
  role: "administrator" | "user",
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
) {
  return db
    .select({
      tenantId: staffMemberships.tenantId,
      tenantPublicId: tenants.publicId,
      tenantName: tenants.name,
      membershipId: staffMemberships.id,
      role: staffMemberships.role,
    })
    .from(staffIdentities)
    .innerJoin(
      staffMemberships,
      eq(staffMemberships.staffIdentityId, staffIdentities.id),
    )
    .innerJoin(tenants, eq(tenants.id, staffMemberships.tenantId))
    .where(
      and(
        eq(staffIdentities.providerSubject, providerSubject),
        eq(staffMemberships.status, "active"),
      ),
    );
}
