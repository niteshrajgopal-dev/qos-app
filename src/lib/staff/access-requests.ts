import { desc, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  locations,
  staffAccessRequests,
  tenants,
} from "@/db/schema";
import type { StaffIdentity } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class AccessRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AccessRequestError";
    this.statusCode = statusCode;
  }
}

export class AccessRequestConflictError extends AccessRequestError {
  constructor(message: string) {
    super(message, 409);
    this.name = "AccessRequestConflictError";
  }
}

type SubmitAccessRequestInput = {
  tenantPublicId: string;
  identity: StaffIdentity;
};

type SubmitAccessRequestResult = {
  id: string;
  tenantId: string;
  tenantPublicId: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  createdAt: Date;
  idempotentReplay: boolean;
};

type RequesterAccessRequestView = {
  id: string;
  tenantPublicId: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type AdminAccessRequestView = {
  id: string;
  requesterSubject: string;
  requesterEmail: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  decidedBySubject: string | null;
  decidedRole: "administrator" | "user" | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unexpected error.";
  }

  const cause = (error as { cause?: Error }).cause;
  if (cause?.message && !error.message.startsWith("Failed query")) {
    return cause.message;
  }

  if (cause?.message && error.message.startsWith("Failed query")) {
    return cause.message;
  }

  return error.message;
}

function mapAccessRequestError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }

  const message = extractErrorMessage(error);

  if (
    message.includes("version conflict") ||
    message.includes("no longer pending")
  ) {
    throw new AccessRequestConflictError(message);
  }

  if (
    message.includes("Administrator membership required") ||
    message.includes("cannot decide their own")
  ) {
    throw new AccessRequestError(message, 403);
  }

  if (message.includes("not found")) {
    throw new AccessRequestError(message, 404);
  }

  throw new AccessRequestError(message);
}

export async function submitAccessRequest(
  db: DbClient,
  input: SubmitAccessRequestInput,
): Promise<SubmitAccessRequestResult> {
  const tenantPublicId = input.tenantPublicId.trim();

  if (!tenantPublicId) {
    throw new AccessRequestError("tenantPublicId is required.");
  }

  try {
    const rows = await db.execute<{
      id: string;
      tenant_id: string;
      tenant_public_id: string;
      status: "pending" | "approved" | "rejected";
      version: number;
      created_at: Date;
    }>(
      sql`select * from qos.submit_staff_access_request(
        ${tenantPublicId},
        ${input.identity.subject},
        ${input.identity.email}
      )`,
    );

    const row = rows[0];
    if (!row) {
      throw new AccessRequestError("Unable to submit access request.");
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      tenantPublicId: row.tenant_public_id,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      idempotentReplay: false,
    };
  } catch (error) {
    mapAccessRequestError(error);
  }
}

export async function getRequesterAccessRequest(
  db: DbClient,
  requestId: string,
  subject: string,
): Promise<RequesterAccessRequestView> {
  const rows = await db.execute<{
    id: string;
    tenant_public_id: string;
    status: "pending" | "approved" | "rejected";
    version: number;
    decision_note: string | null;
    created_at: Date;
    decided_at: Date | null;
  }>(
    sql`select * from qos.get_staff_access_request_for_requester(
      ${requestId}::uuid,
      ${subject}
    )`,
  );

  const row = rows[0];
  if (!row) {
    throw new AccessRequestError("Access request not found.", 404);
  }

  return {
    id: row.id,
    tenantPublicId: row.tenant_public_id,
    status: row.status,
    version: row.version,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

export async function listAccessRequestsForTenant(
  db: DbClient,
  tenantId: string,
): Promise<AdminAccessRequestView[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: staffAccessRequests.id,
        requesterSubject: staffAccessRequests.requesterSubject,
        requesterEmail: staffAccessRequests.requesterEmail,
        status: staffAccessRequests.status,
        version: staffAccessRequests.version,
        decidedBySubject: staffAccessRequests.decidedBySubject,
        decidedRole: staffAccessRequests.decidedRole,
        decisionNote: staffAccessRequests.decisionNote,
        createdAt: staffAccessRequests.createdAt,
        decidedAt: staffAccessRequests.decidedAt,
      })
      .from(staffAccessRequests)
      .where(eq(staffAccessRequests.tenantId, tenantId))
      .orderBy(desc(staffAccessRequests.createdAt));

    return rows;
  });
}

export async function listTenantLocationsForAdmin(
  db: DbClient,
  tenantId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    return tx
      .select({
        id: locations.id,
        publicId: locations.publicId,
        name: locations.name,
        slug: locations.slug,
      })
      .from(locations)
      .where(eq(locations.tenantId, tenantId))
      .orderBy(locations.name);
  });
}

type ApproveAccessRequestInput = {
  tenantId: string;
  requestId: string;
  adminSubject: string;
  expectedVersion: number;
  role: "administrator" | "user";
  locationIds: string[];
};

type DecisionResult = {
  id: string;
  status: "approved" | "rejected";
  version: number;
  membershipId?: string;
  decidedAt: Date;
};

export async function approveAccessRequest(
  db: DbClient,
  input: ApproveAccessRequestInput,
): Promise<DecisionResult> {
  if (!input.locationIds.length) {
    throw new AccessRequestError("At least one location is required.");
  }

  try {
    const locationArray = `{${input.locationIds.join(",")}}`;
    const rows = await db.execute<{
      id: string;
      status: "approved";
      version: number;
      membership_id: string;
      decided_at: Date;
    }>(
      sql`select * from qos.approve_staff_access_request(
        ${input.tenantId}::uuid,
        ${input.requestId}::uuid,
        ${input.adminSubject},
        ${input.expectedVersion},
        ${input.role}::qos.staff_role,
        ${locationArray}::uuid[]
      )`,
    );

    const row = rows[0];
    if (!row) {
      throw new AccessRequestConflictError("Access request version conflict.");
    }

    return {
      id: row.id,
      status: row.status,
      version: row.version,
      membershipId: row.membership_id,
      decidedAt: row.decided_at,
    };
  } catch (error) {
    mapAccessRequestError(error);
  }
}

type RejectAccessRequestInput = {
  tenantId: string;
  requestId: string;
  adminSubject: string;
  expectedVersion: number;
  decisionNote?: string;
};

export async function rejectAccessRequest(
  db: DbClient,
  input: RejectAccessRequestInput,
): Promise<DecisionResult> {
  try {
    const rows = await db.execute<{
      id: string;
      status: "rejected";
      version: number;
      decided_at: Date;
    }>(
      sql`select * from qos.reject_staff_access_request(
        ${input.tenantId}::uuid,
        ${input.requestId}::uuid,
        ${input.adminSubject},
        ${input.expectedVersion},
        ${input.decisionNote ?? null}
      )`,
    );

    const row = rows[0];
    if (!row) {
      throw new AccessRequestConflictError("Access request version conflict.");
    }

    return {
      id: row.id,
      status: row.status,
      version: row.version,
      decidedAt: row.decided_at,
    };
  } catch (error) {
    mapAccessRequestError(error);
  }
}

export async function getProtectedStaffSummary(
  db: DbClient,
  tenantId: string,
  subject: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({
        id: tenants.id,
        publicId: tenants.publicId,
        name: tenants.name,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      throw new AccessRequestError("Business not found.", 404);
    }

    const membershipRows = await tx.execute<{
      role: "administrator" | "user";
      location_ids: string[] | null;
    }>(
      sql`
        select
          sm.role,
          array_agg(sls.location_id order by sls.location_id) filter (
            where sls.location_id is not null
          ) as location_ids
        from qos.staff_identities si
        inner join qos.staff_memberships sm
          on sm.staff_identity_id = si.id
        left join qos.staff_location_scopes sls
          on sls.staff_membership_id = sm.id
          and sls.tenant_id = sm.tenant_id
        where si.provider_subject = ${subject}
          and sm.tenant_id = ${tenantId}::uuid
          and sm.status = 'active'
        group by sm.role
        limit 1
      `,
    );

    const membership = membershipRows[0];
    if (!membership) {
      throw new AccessRequestError(
        "Active staff membership is required for this business.",
        403,
      );
    }

    return {
      tenant: {
        id: tenant.id,
        publicId: tenant.publicId,
        name: tenant.name,
      },
      role: membership.role,
      locationIds: membership.location_ids ?? [],
    };
  });
}
