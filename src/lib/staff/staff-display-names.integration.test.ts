import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffAuthUsers, staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { resolveStaffDisplayNames } from "@/lib/staff/staff-display-names";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { withTenantContext } from "@/lib/tenant/context";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("resolveStaffDisplayNames (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.staff_memberships, qos.staff_identities, qos.staff_auth_users, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedStaff(
    tenantId: string,
    subject: string,
    email: string,
    name: string | null,
  ) {
    if (name !== null) {
      await db.insert(staffAuthUsers).values({ id: subject, name, email });
    }
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email })
      .returning();
    await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" });
  }

  it("names tenant members, falls back to email, and never resolves other tenants' staff", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    await seedStaff(quotes.tenant.id, "sub_named", "named@quotes.test", "Quotes Demo Admin");
    await seedStaff(quotes.tenant.id, "sub_blank", "blank@quotes.test", "  ");
    await seedStaff(quotes.tenant.id, "sub_no_profile", "noprofile@quotes.test", null);
    await seedStaff(flowers.tenant.id, "sub_flowers", "owner@flowers.test", "Flowers Owner");

    const names = await runAsRole(sqlClient, "qos_app", () =>
      withTenantContext(db, quotes.tenant.id, (tx) =>
        resolveStaffDisplayNames(tx, quotes.tenant.id, [
          "sub_named",
          "sub_blank",
          "sub_no_profile",
          "sub_flowers",
          "sub_missing",
          "sub_named",
        ]),
      ),
    );

    expect(Object.fromEntries(names)).toEqual({
      sub_named: "Quotes Demo Admin",
      sub_blank: "blank@quotes.test",
      sub_no_profile: "noprofile@quotes.test",
    });
  });

  it("returns an empty map without querying when there are no subjects", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const names = await withTenantContext(db, quotes.tenant.id, (tx) =>
      resolveStaffDisplayNames(tx, quotes.tenant.id, ["", ""]),
    );
    expect(names.size).toBe(0);
  });
});
