import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { listTenantStaffMembers } from "@/lib/staff/memberships";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("listTenantStaffMembers", () => {
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

  async function seedMember(input: {
    tenantId: string;
    email: string;
    role: "administrator" | "user";
    status?: "active" | "revoked";
    locationIds?: string[];
  }) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: input.email, email: input.email })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId: input.tenantId,
        staffIdentityId: identity.id,
        role: input.role,
        status: input.status ?? "active",
      })
      .returning();

    for (const locationId of input.locationIds ?? []) {
      await db.insert(staffLocationScopes).values({
        tenantId: input.tenantId,
        staffMembershipId: membership.id,
        locationId,
      });
    }

    return membership;
  }

  it("lists only the tenant's members with their location scopes", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    const admin = await seedMember({
      tenantId: quotes.tenant.id,
      email: "admin@quotes.test",
      role: "administrator",
      locationIds: [quotes.location.id],
    });
    const revoked = await seedMember({
      tenantId: quotes.tenant.id,
      email: "former@quotes.test",
      role: "user",
      status: "revoked",
    });
    await seedMember({
      tenantId: flowers.tenant.id,
      email: "staff@flowers.test",
      role: "user",
      locationIds: [flowers.location.id],
    });

    const members = await listTenantStaffMembers(db, quotes.tenant.id);

    expect(members.map((member) => member.membershipId)).toEqual([
      admin.id,
      revoked.id,
    ]);
    expect(members[0]).toMatchObject({
      email: "admin@quotes.test",
      role: "administrator",
      status: "active",
      locations: [
        { publicId: quotes.location.publicId, name: quotes.location.name },
      ],
    });
    expect(members[1]).toMatchObject({
      email: "former@quotes.test",
      status: "revoked",
      locations: [],
    });
  });
});
