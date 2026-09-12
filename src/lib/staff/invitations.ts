import { createHash, randomBytes } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  locations,
  staffInvitationLocations,
  staffInvitations,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import type { StaffIdentity } from "@/lib/staff/auth";
import { readStaffInvitationTtlSeconds } from "@/lib/staff/config";
import { ensureStaffIdentityRecord } from "@/lib/staff/identity-sync";
import { withTenantContext } from "@/lib/tenant/context";

export class StaffInvitationError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "StaffInvitationError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function generateStaffInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

export function buildStaffInvitationExpiry(now = new Date()) {
  return new Date(
    now.getTime() + readStaffInvitationTtlSeconds() * 1000,
  );
}

export type RedeemStaffInvitationInput = {
  token: string;
  identity: StaffIdentity;
};

export type RedeemStaffInvitationResult = {
  tenantId: string;
  membershipId: string;
  role: "administrator" | "user";
  staffIdentityId: string;
  locationIds: string[];
  idempotentReplay: boolean;
};

export async function redeemStaffInvitation(
  db: DbClient,
  input: RedeemStaffInvitationInput,
): Promise<RedeemStaffInvitationResult> {
  const token = input.token.trim();
  if (!token) {
    throw new StaffInvitationError("Invitation token is required.", 400, "token");
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const normalizedEmail = input.identity.email.trim().toLowerCase();

  const [invitation] = await db
    .select()
    .from(staffInvitations)
    .where(eq(staffInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    throw new StaffInvitationError("Invitation not found.", 404, "token");
  }

  if (invitation.email.trim().toLowerCase() !== normalizedEmail) {
    throw new StaffInvitationError(
      "Invitation email does not match the signed-in staff account.",
      403,
      "email",
    );
  }

  if (invitation.status === "revoked") {
    throw new StaffInvitationError("Invitation has been revoked.", 409, "token");
  }

  if (invitation.status === "expired") {
    throw new StaffInvitationError("Invitation has expired.", 409, "token");
  }

  if (invitation.expiresAt && invitation.expiresAt.getTime() <= Date.now()) {
    throw new StaffInvitationError("Invitation has expired.", 409, "token");
  }

  const staffIdentity = await ensureStaffIdentityRecord(
    db,
    input.identity.subject,
    normalizedEmail,
  );

  return withTenantContext(db, invitation.tenantId, async (tx) => {
    if (invitation.status === "accepted") {
      const [membership] = await tx
        .select({
          id: staffMemberships.id,
          role: staffMemberships.role,
          staffIdentityId: staffMemberships.staffIdentityId,
        })
        .from(staffMemberships)
        .where(
          and(
            eq(staffMemberships.tenantId, invitation.tenantId),
            eq(staffMemberships.staffIdentityId, staffIdentity.id),
            eq(staffMemberships.status, "active"),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new StaffInvitationError(
          "Invitation was already accepted but membership is unavailable.",
          409,
          "token",
        );
      }

      const scopedLocations = await tx
        .select({ locationId: staffLocationScopes.locationId })
        .from(staffLocationScopes)
        .where(
          and(
            eq(staffLocationScopes.tenantId, invitation.tenantId),
            eq(staffLocationScopes.staffMembershipId, membership.id),
          ),
        );

      return {
        tenantId: invitation.tenantId,
        membershipId: membership.id,
        role: membership.role,
        staffIdentityId: membership.staffIdentityId,
        locationIds: scopedLocations.map((row) => row.locationId),
        idempotentReplay: true,
      };
    }

    if (invitation.status !== "pending") {
      throw new StaffInvitationError(
        "Invitation cannot be redeemed in its current state.",
        409,
        "token",
      );
    }

    const invitationLocations = await tx
      .select({ locationId: staffInvitationLocations.locationId })
      .from(staffInvitationLocations)
      .where(
        and(
          eq(staffInvitationLocations.tenantId, invitation.tenantId),
          eq(staffInvitationLocations.invitationId, invitation.id),
        ),
      );

    const [membership] = await tx
      .insert(staffMemberships)
      .values({
        tenantId: invitation.tenantId,
        staffIdentityId: staffIdentity.id,
        role: invitation.role,
        status: "active",
      })
      .onConflictDoNothing({
        target: [staffMemberships.tenantId, staffMemberships.staffIdentityId],
      })
      .returning({
        id: staffMemberships.id,
        role: staffMemberships.role,
        staffIdentityId: staffMemberships.staffIdentityId,
      });

    let activeMembership = membership;

    if (!activeMembership) {
      const [existingMembership] = await tx
        .select({
          id: staffMemberships.id,
          role: staffMemberships.role,
          staffIdentityId: staffMemberships.staffIdentityId,
        })
        .from(staffMemberships)
        .where(
          and(
            eq(staffMemberships.tenantId, invitation.tenantId),
            eq(staffMemberships.staffIdentityId, staffIdentity.id),
          ),
        )
        .limit(1);

      if (!existingMembership || existingMembership.role !== invitation.role) {
        throw new StaffInvitationError(
          "Staff membership already exists with a different role.",
          409,
          "token",
        );
      }

      activeMembership = existingMembership;
    }

    if (invitationLocations.length > 0) {
      await tx.insert(staffLocationScopes).values(
        invitationLocations.map((row) => ({
          tenantId: invitation.tenantId,
          staffMembershipId: activeMembership.id,
          locationId: row.locationId,
        })),
      ).onConflictDoNothing();
    }

    await tx
      .update(staffInvitations)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByStaffIdentityId: staffIdentity.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(staffInvitations.tenantId, invitation.tenantId),
          eq(staffInvitations.id, invitation.id),
          eq(staffInvitations.status, "pending"),
        ),
      );

    const scopedLocations = await tx
      .select({ locationId: staffLocationScopes.locationId })
      .from(staffLocationScopes)
      .where(
        and(
          eq(staffLocationScopes.tenantId, invitation.tenantId),
          eq(staffLocationScopes.staffMembershipId, activeMembership.id),
        ),
      );

    return {
      tenantId: invitation.tenantId,
      membershipId: activeMembership.id,
      role: activeMembership.role,
      staffIdentityId: activeMembership.staffIdentityId,
      locationIds: scopedLocations.map((row) => row.locationId),
      idempotentReplay: false,
    };
  });
}

export async function assignInvitationLocationsForTenant(
  db: DbClient,
  tenantId: string,
  invitationId: string,
  locationIds: string[],
) {
  if (locationIds.length === 0) {
    return;
  }

  const validLocations = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(eq(locations.tenantId, tenantId), inArray(locations.id, locationIds)),
    );

  if (validLocations.length !== locationIds.length) {
    throw new StaffInvitationError(
      "One or more invitation locations are invalid for this tenant.",
      400,
      "locationIds",
    );
  }

  await db.insert(staffInvitationLocations).values(
    locationIds.map((locationId) => ({
      tenantId,
      invitationId,
      locationId,
    })),
  );
}
