import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { locations, staffLocationScopes, tenants } from "@/db/schema";
import {
  type ActiveStaffMembership,
  requireActiveStaffMembership,
  StaffAuthorizationError,
} from "@/lib/staff/auth";
import {
  ALL_BRANCHES,
  type BranchContextPayload,
  type BranchSelection,
  defaultBranchSelection,
  isAllBranchesAllowed,
  type PermittedBranch,
  REQUESTED_BUSINESS_BRANCH_LABELS,
} from "@/lib/staff/branch-selection";
import { withTenantContext } from "@/lib/tenant/context";
import { requireActiveTenant } from "@/lib/tenant/tenant-status";

export {
  ALL_BRANCHES,
  REQUESTED_BUSINESS_BRANCH_LABELS,
  resolveBranchSelection,
} from "@/lib/staff/branch-selection";
export type {
  BranchContextPayload,
  BranchSelection,
  PermittedBranch,
} from "@/lib/staff/branch-selection";

/* Server-side branch context for the staff app (QOS-192). Branches are the
   existing `locations` rows: administrators see every location of the tenant,
   users only the locations they hold a `staff_location_scopes` row for.
   Nothing here creates, renames or reassigns a location. */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Active membership for the branch context routes. Someone who is not a
 * member of the tenant (including a member of a different tenant) gets 404 so
 * the route does not confirm that another business exists. Members of an
 * inactive tenant keep the existing `tenant_inactive` 403.
 */
export async function requireBranchContextMembership(
  db: DbClient,
  tenantId: string,
  subject: string,
): Promise<ActiveStaffMembership> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new StaffAuthorizationError("Business not found.", 404);
  }

  let membership: ActiveStaffMembership;
  try {
    membership = await requireActiveStaffMembership(db, tenantId, subject, {
      requireActiveTenant: false,
    });
  } catch (error) {
    if (error instanceof StaffAuthorizationError) {
      throw new StaffAuthorizationError("Business not found.", 404);
    }
    throw error;
  }

  await requireActiveTenant(db, tenantId);
  return membership;
}

/** Locations the membership may work in, active first, then by name. */
export async function listPermittedBranches(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
): Promise<PermittedBranch[]> {
  return (await loadBranchContext(db, tenantId, membership)).branches;
}

export async function loadBranchContext(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
): Promise<BranchContextPayload> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ baseCurrency: tenants.baseCurrency })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new StaffAuthorizationError("Business not found.", 404);
    }

    const columns = {
      publicId: locations.publicId,
      name: locations.name,
      status: locations.status,
      timezone: locations.timezone,
    };
    const order = [asc(locations.status), asc(locations.name), asc(locations.publicId)];

    const rows =
      membership.role === "administrator"
        ? await tx
            .select(columns)
            .from(locations)
            .where(eq(locations.tenantId, tenantId))
            .orderBy(...order)
        : await tx
            .select(columns)
            .from(staffLocationScopes)
            .innerJoin(
              locations,
              and(
                eq(locations.tenantId, staffLocationScopes.tenantId),
                eq(locations.id, staffLocationScopes.locationId),
              ),
            )
            .where(
              and(
                eq(staffLocationScopes.tenantId, tenantId),
                eq(staffLocationScopes.staffMembershipId, membership.membershipId),
              ),
            )
            .orderBy(...order);

    const currency = tenant.baseCurrency.trim();
    const branches: PermittedBranch[] = rows.map((row) => ({ ...row, currency }));
    const allBranchesAllowed = isAllBranchesAllowed(membership.role, branches.length);

    return {
      baseCurrency: currency,
      role: membership.role,
      branches,
      allBranchesAllowed,
      defaultSelection: defaultBranchSelection(membership.role, branches, allBranchesAllowed),
      requestedBusinessLabels: REQUESTED_BUSINESS_BRANCH_LABELS.map((label) => ({ ...label })),
    };
  });
}

/**
 * Validates a branch requested for a read (deep link, filter). All Branches is
 * accepted only when the context allows it; a location outside the permitted
 * list is rejected the same way whether it exists in another scope, another
 * tenant or nowhere.
 */
export function assertReadableBranch(
  requested: string,
  context: Pick<BranchContextPayload, "branches" | "allBranchesAllowed">,
): BranchSelection {
  if (requested === ALL_BRANCHES) {
    if (!context.allBranchesAllowed) {
      throw new StaffAuthorizationError(
        "All branches is not available for this membership.",
      );
    }
    return ALL_BRANCHES;
  }

  if (!context.branches.some((branch) => branch.publicId === requested)) {
    throw new StaffAuthorizationError(
      "Staff membership does not include the requested branch.",
    );
  }

  return requested;
}

/**
 * Guard for every operational posting (stock, sales, prep). A posting needs
 * one explicit branch the caller is permitted to work in: All Branches, an
 * empty selection or a location outside the permitted list is rejected.
 * Later posting services must call this on the server with the list from
 * `listPermittedBranches`, never with a list supplied by the client.
 */
export function assertOperationalBranch(
  selection: BranchSelection | null | undefined,
  permitted: readonly PermittedBranch[],
): PermittedBranch {
  if (!selection) {
    throw new StaffAuthorizationError("Choose one branch for this operation.");
  }

  if (selection === ALL_BRANCHES) {
    throw new StaffAuthorizationError(
      "All branches is a read view. Choose one branch for this operation.",
    );
  }

  const branch = permitted.find((candidate) => candidate.publicId === selection);
  if (!branch) {
    throw new StaffAuthorizationError(
      "Staff membership does not include the requested branch.",
    );
  }

  return branch;
}

export class WarehouseGuardNotImplementedError extends Error {
  constructor() {
    super("Warehouses do not exist yet; they arrive with QOS-196.");
    this.name = "WarehouseGuardNotImplementedError";
  }
}

/**
 * Placeholder for the warehouse half of the posting rule. QOS has no
 * warehouses yet (QOS-196 adds them), so there is nothing to check against.
 * It always throws, so any caller fails closed instead of treating an
 * unchecked warehouse as valid.
 */
export function assertWarehouseBelongsToBranch(
  warehousePublicId: string,
  branch: PermittedBranch,
): never {
  void warehousePublicId;
  void branch;
  throw new WarehouseGuardNotImplementedError();
}
