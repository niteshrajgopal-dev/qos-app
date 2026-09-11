import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { staffIdentities, staffMemberships } from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";

export type StaffIdentity = {
  subject: string;
  email: string;
};

export class StaffAuthorizationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "StaffAuthorizationError";
    this.statusCode = statusCode;
  }
}

function readHeader(headers: Headers, name: string) {
  return headers.get(name)?.trim() ?? "";
}

export function requireStaffIdentity(headers: Headers): StaffIdentity {
  const subject = readHeader(headers, "x-qos-staff-subject");
  const email = readHeader(headers, "x-qos-staff-email");

  if (!subject) {
    throw new StaffAuthorizationError(
      "Staff identity subject is required.",
      401,
    );
  }

  if (!email) {
    throw new StaffAuthorizationError("Staff email is required.", 401);
  }

  return { subject, email };
}

export type ActiveStaffMembership = {
  membershipId: string;
  role: "administrator" | "user";
  staffIdentityId: string;
};

export async function requireActiveStaffMembership(
  db: DbClient,
  tenantId: string,
  subject: string,
): Promise<ActiveStaffMembership> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [membership] = await tx
      .select({
        membershipId: staffMemberships.id,
        role: staffMemberships.role,
        staffIdentityId: staffMemberships.staffIdentityId,
      })
      .from(staffIdentities)
      .innerJoin(
        staffMemberships,
        eq(staffMemberships.staffIdentityId, staffIdentities.id),
      )
      .where(
        and(
          eq(staffIdentities.providerSubject, subject),
          eq(staffMemberships.tenantId, tenantId),
          eq(staffMemberships.status, "active"),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new StaffAuthorizationError(
        "Active staff membership is required for this business.",
      );
    }

    return membership;
  });
}

export async function requireAdministratorMembership(
  db: DbClient,
  tenantId: string,
  subject: string,
): Promise<ActiveStaffMembership> {
  const membership = await requireActiveStaffMembership(db, tenantId, subject);

  if (membership.role !== "administrator") {
    throw new StaffAuthorizationError(
      "Administrator membership is required for this action.",
    );
  }

  return membership;
}
