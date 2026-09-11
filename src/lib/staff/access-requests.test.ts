import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  staffIdentities,
  staffMemberships,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
  tableCount,
} from "@/db/test-utils";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import {
  AccessRequestConflictError,
  AccessRequestError,
  approveAccessRequest,
  getProtectedStaffSummary,
  getRequesterAccessRequest,
  listAccessRequestsForTenant,
  rejectAccessRequest,
  submitAccessRequest,
} from "@/lib/staff/access-requests";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("staff access requests", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(
    tenantId: string,
    subject = "admin@quotes.test",
    email = "admin@quotes.test",
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email })
      .returning();

    await db.insert(staffMemberships).values({
      tenantId,
      staffIdentityId: identity.id,
      role: "administrator",
    });
  }

  it("blocks pending requesters from protected business APIs", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    await seedAdministrator(quotes.tenant.id);

    const request = await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity: {
        subject: "pending.staff@qosapp.com",
        email: "pending.staff@qosapp.com",
      },
    });

    expect(request.status).toBe("pending");

    await expect(
      getProtectedStaffSummary(
        db,
        quotes.tenant.id,
        "pending.staff@qosapp.com",
      ),
    ).rejects.toBeInstanceOf(AccessRequestError);

    await expect(
      getProtectedStaffSummary(
        db,
        flowers.tenant.id,
        "pending.staff@qosapp.com",
      ),
    ).rejects.toBeInstanceOf(AccessRequestError);
  });

  it("prevents tenant A administrators from approving tenant B requests", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    await seedAdministrator(quotes.tenant.id, "admin.quotes@test", "admin.quotes@test");
    await seedAdministrator(flowers.tenant.id, "admin.flowers@test", "admin.flowers@test");

    const request = await submitAccessRequest(db, {
      tenantPublicId: flowers.tenant.publicId,
      identity: {
        subject: "requester.flowers@test",
        email: "requester.flowers@test",
      },
    });

    await expect(
      approveAccessRequest(db, {
        tenantId: quotes.tenant.id,
        requestId: request.id,
        adminSubject: "admin.quotes@test",
        expectedVersion: request.version,
        role: "user",
        locationIds: [flowers.location.id],
      }),
    ).rejects.toBeInstanceOf(AccessRequestError);
  });

  it("creates one membership under concurrent approval attempts", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    await seedAdministrator(quotes.tenant.id);

    const request = await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity: {
        subject: "concurrent.staff@test",
        email: "concurrent.staff@test",
      },
    });

    const attempts = await Promise.allSettled([
      approveAccessRequest(db, {
        tenantId: quotes.tenant.id,
        requestId: request.id,
        adminSubject: "admin@quotes.test",
        expectedVersion: request.version,
        role: "user",
        locationIds: [quotes.location.id],
      }),
      approveAccessRequest(db, {
        tenantId: quotes.tenant.id,
        requestId: request.id,
        adminSubject: "admin@quotes.test",
        expectedVersion: request.version,
        role: "user",
        locationIds: [quotes.location.id],
      }),
    ]);

    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(AccessRequestConflictError);
    expect(await tableCount(sqlClient, "staff_memberships")).toBe(2);
  });

  it("rejects replaying a rejected request as approved", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    await seedAdministrator(quotes.tenant.id);

    const request = await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity: {
        subject: "rejected.staff@test",
        email: "rejected.staff@test",
      },
    });

    await rejectAccessRequest(db, {
      tenantId: quotes.tenant.id,
      requestId: request.id,
      adminSubject: "admin@quotes.test",
      expectedVersion: request.version,
      decisionNote: "Not authorized",
    });

    await expect(
      approveAccessRequest(db, {
        tenantId: quotes.tenant.id,
        requestId: request.id,
        adminSubject: "admin@quotes.test",
        expectedVersion: request.version,
        role: "user",
        locationIds: [quotes.location.id],
      }),
    ).rejects.toBeInstanceOf(AccessRequestConflictError);
  });

  it("grants protected access after approval and removes it when membership is revoked", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    await seedAdministrator(quotes.tenant.id);

    const request = await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity: {
        subject: "approved.staff@test",
        email: "approved.staff@test",
      },
    });

    const decision = await approveAccessRequest(db, {
      tenantId: quotes.tenant.id,
      requestId: request.id,
      adminSubject: "admin@quotes.test",
      expectedVersion: request.version,
      role: "user",
      locationIds: [quotes.location.id],
    });

    expect(decision.status).toBe("approved");

    const summary = await getProtectedStaffSummary(
      db,
      quotes.tenant.id,
      "approved.staff@test",
    );
    expect(summary.role).toBe("user");
    expect(summary.locationIds).toEqual([quotes.location.id]);

    const [membership] = await db
      .select()
      .from(staffMemberships)
      .where(eq(staffMemberships.id, decision.membershipId!));

    await db
      .update(staffMemberships)
      .set({ status: "revoked" })
      .where(eq(staffMemberships.id, membership.id));

    await expect(
      getProtectedStaffSummary(db, quotes.tenant.id, "approved.staff@test"),
    ).rejects.toBeInstanceOf(AccessRequestError);
  });

  it("returns idempotent pending submissions for the same requester", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    await seedAdministrator(quotes.tenant.id);

    const identity = {
      subject: "repeat.staff@test",
      email: "repeat.staff@test",
    };

    const first = await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity,
    });
    const second = await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity,
    });

    expect(second.id).toBe(first.id);
    expect(await tableCount(sqlClient, "staff_access_requests")).toBe(1);
  });

  it("lists pending requests for tenant administrators without exposing other tenants", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    await seedAdministrator(quotes.tenant.id);
    await seedAdministrator(flowers.tenant.id, "admin.flowers@test", "admin.flowers@test");

    await submitAccessRequest(db, {
      tenantPublicId: quotes.tenant.publicId,
      identity: {
        subject: "quotes.requester@test",
        email: "quotes.requester@test",
      },
    });
    await submitAccessRequest(db, {
      tenantPublicId: flowers.tenant.publicId,
      identity: {
        subject: "flowers.requester@test",
        email: "flowers.requester@test",
      },
    });

    const quotesRequests = await listAccessRequestsForTenant(db, quotes.tenant.id);
    expect(quotesRequests).toHaveLength(1);
    expect(quotesRequests[0]?.requesterSubject).toBe("quotes.requester@test");

    const requesterView = await getRequesterAccessRequest(
      db,
      quotesRequests[0]!.id,
      "quotes.requester@test",
    );
    expect(requesterView.tenantPublicId).toBe("ten_quotes_dev");
    expect(requesterView.status).toBe("pending");
  });
});
