import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
  tableCount,
} from "@/db/test-utils";
import {
  clearTenantContext,
  readTenantContext,
  withTenantContext,
} from "@/lib/tenant/context";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";
import {
  createTenantHierarchy,
  deleteTenant,
  listTenantLocations,
  updateLocationName,
} from "@/lib/tenant/repository";

const describeIntegration = hasIntegrationDatabase()
  ? describe
  : describe.skip;

describeIntegration("tenant isolation", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    ({ db, sql: sqlClient } = await resetAndMigrate());
    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_migrator");
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient.end({ timeout: 5 });
    }
  });

  it("seeds independent Quotes and flower tenants via migrator path", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    expect(quotes.tenant.publicId).toBe("ten_quotes_dev");
    expect(flowers.tenant.publicId).toBe("ten_flowers_dev");
    expect(await tableCount(sqlClient, "tenants")).toBe(2);
  });

  it("prevents tenant A from reading or mutating tenant B locations under qos_app RLS", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    await runAsRole(sqlClient, "qos_app", async () => {
      const visibleForQuotes = await withTenantContext(
        db,
        quotes.tenant.id,
        async (tx) => listTenantLocations(tx, quotes.tenant.id),
      );
      expect(visibleForQuotes).toHaveLength(1);
      expect(visibleForQuotes[0]?.name).toBe("HBZ Stadium");

      const crossTenantUpdate = await withTenantContext(
        db,
        quotes.tenant.id,
        async (tx) =>
          updateLocationName(
            tx,
            quotes.tenant.id,
            flowers.location.id,
            "Blocked rename",
          ),
      );
      expect(crossTenantUpdate).toBeNull();

      await withTenantContext(db, quotes.tenant.id, async (tx) => {
        await expect(
          deleteTenant(tx, flowers.tenant.id),
        ).resolves.toEqual([]);
      });

      const stillHidden = await withTenantContext(
        db,
        quotes.tenant.id,
        async (tx) => listTenantLocations(tx, flowers.tenant.id),
      );
      expect(stillHidden).toHaveLength(0);
    });
  });

  it("does not retain tenant context across pooled connections after failed transactions", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    await runAsRole(sqlClient, "qos_app", async () => {
      await expect(
        withTenantContext(db, quotes.tenant.id, async (tx) => {
          await listTenantLocations(tx, quotes.tenant.id);
          throw new Error("forced rollback");
        }),
      ).rejects.toThrow("forced rollback");

      const contextAfterFailure = await withTenantContext(
        db,
        flowers.tenant.id,
        async (tx) => readTenantContext(tx),
      );
      expect(contextAfterFailure).toBe(flowers.tenant.id);

      const visibleLocations = await withTenantContext(
        db,
        flowers.tenant.id,
        async (tx) => listTenantLocations(tx, flowers.tenant.id),
      );
      expect(visibleLocations).toHaveLength(1);
      expect(visibleLocations[0]?.name).toBe("Main Shop");
    });
  });

  it("rejects cross-tenant parent references at the database boundary", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    await expect(
      db.insert(locations).values({
        tenantId: quotes.tenant.id,
        brandId: flowers.brand.id,
        publicId: "loc_cross_tenant",
        name: "Invalid",
        slug: "invalid",
        timezone: "Asia/Dubai",
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(staffLocationScopes).values({
        tenantId: quotes.tenant.id,
        staffMembershipId: crypto.randomUUID(),
        locationId: flowers.location.id,
      }),
    ).rejects.toThrow();
  });

  it("blocks qos_app from DDL and ownership changes", async () => {
    await runAsRole(sqlClient, "qos_app", async () => {
      await expect(
        db.execute(sql`CREATE TABLE qos.elevated_probe (id uuid)`),
      ).rejects.toThrow();

      await expect(
        db.execute(sql`ALTER TABLE qos.tenants OWNER TO qos_app`),
      ).rejects.toThrow();
    });
  });

  it("fails closed when tenant context is missing under qos_app", async () => {
    await createTenantHierarchy(db, quotesTenantFixture());

    await runAsRole(sqlClient, "qos_app", async () => {
      const rows = await db.select().from(locations);
      expect(rows).toHaveLength(0);

      await expect(clearTenantContext(db)).resolves.toBeUndefined();
    });
  });

  it("rejects partial tenant creation when required fields are missing", async () => {
    const input = quotesTenantFixture();
    input.tenant.defaultTimezone = "";

    await expect(createTenantHierarchy(db, input)).rejects.toThrow(
      /defaultTimezone/,
    );
    expect(await tableCount(sqlClient, "tenants")).toBe(0);
    expect(await tableCount(sqlClient, "organizations")).toBe(0);
  });

  it("allows scoped staff location assignment only within the same tenant", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    const [identity] = await db
      .insert(staffIdentities)
      .values({
        email: "admin@quotes.test",
        providerSubject: "admin@quotes.test",
      })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId: quotes.tenant.id,
        staffIdentityId: identity.id,
        role: "administrator",
      })
      .returning();

    const [scope] = await db
      .insert(staffLocationScopes)
      .values({
        tenantId: quotes.tenant.id,
        staffMembershipId: membership.id,
        locationId: quotes.location.id,
      })
      .returning();
    expect(scope.locationId).toBe(quotes.location.id);

    await expect(
      db.insert(staffLocationScopes).values({
        tenantId: quotes.tenant.id,
        staffMembershipId: membership.id,
        locationId: flowers.location.id,
      }),
    ).rejects.toThrow();
  });
});
