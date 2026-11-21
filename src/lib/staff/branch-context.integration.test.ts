import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { locations, staffIdentities, staffLocationScopes, staffMemberships, tenants } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import {
  ALL_BRANCHES,
  assertOperationalBranch,
  listPermittedBranches,
  loadBranchContext,
  requireBranchContextMembership,
} from "@/lib/staff/branch-context";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("staff branch context (DB)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(
    tenantId: string,
    subject: string,
    role: "administrator" | "user",
    scopedLocationIds: string[] = [],
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    for (const locationId of scopedLocationIds) {
      await db
        .insert(staffLocationScopes)
        .values({ tenantId, staffMembershipId: membership.id, locationId });
    }
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    return { quotes, flowers };
  }

  it("gives administrators every tenant location, active first, with the tenant currency", async () => {
    const { quotes } = await seed();
    await db
      .update(locations)
      .set({ status: "suspended" })
      .where(eq(locations.id, quotes.locationA.id));
    const admin = await seedMember(quotes.tenant.id, "admin@quotes", "administrator");

    const context = await loadBranchContext(db, quotes.tenant.id, admin);

    expect(context.branches).toEqual([
      { publicId: "loc_quotes_hct", name: "HCT Academic City", status: "active", timezone: "Asia/Dubai", currency: "AED" },
      { publicId: "loc_quotes_hbz", name: "HBZ Stadium", status: "suspended", timezone: "Asia/Dubai", currency: "AED" },
    ]);
    expect(context.allBranchesAllowed).toBe(true);
    expect(context.defaultSelection).toBe(ALL_BRANCHES);
    expect(context.baseCurrency).toBe("AED");
    expect(context.requestedBusinessLabels.map((label) => [label.label, label.mappingStatus, label.locationPublicId])).toEqual([
      ["Dubai", "unmapped", null],
      ["Al Ain", "unmapped", null],
      ["Azur Cafe", "unmapped", null],
    ]);
  });

  it("gives users only their scoped locations and no All branches with one scope", async () => {
    const { quotes } = await seed();
    const user = await seedMember(quotes.tenant.id, "user@quotes", "user", [quotes.locationB.id]);

    const context = await loadBranchContext(db, quotes.tenant.id, user);

    expect(context.branches.map((branch) => branch.publicId)).toEqual(["loc_quotes_hct"]);
    expect(context.allBranchesAllowed).toBe(false);
    expect(context.defaultSelection).toBe("loc_quotes_hct");
  });

  it("allows All branches for reads to a user with several scopes", async () => {
    const { quotes } = await seed();
    const user = await seedMember(quotes.tenant.id, "multi@quotes", "user", [
      quotes.locationA.id,
      quotes.locationB.id,
    ]);

    const context = await loadBranchContext(db, quotes.tenant.id, user);

    expect(context.branches).toHaveLength(2);
    expect(context.allBranchesAllowed).toBe(true);
    expect(context.defaultSelection).toBe("loc_quotes_hbz");
  });

  it("returns nothing for a user without scopes", async () => {
    const { quotes } = await seed();
    const user = await seedMember(quotes.tenant.id, "none@quotes", "user");

    const context = await loadBranchContext(db, quotes.tenant.id, user);

    expect(context.branches).toEqual([]);
    expect(context.allBranchesAllowed).toBe(false);
    expect(context.defaultSelection).toBeNull();
  });

  it("never lists another tenant's locations, even as the application role", async () => {
    const { quotes, flowers } = await seed();
    const quotesAdmin = await seedMember(quotes.tenant.id, "admin@quotes", "administrator");

    // A membership from one tenant used against another tenant's id sees only that tenant's rows,
    // and the RLS-bound application role cannot reach across either.
    const branches = await runAsRole(sqlClient, "qos_app", () =>
      listPermittedBranches(db, quotes.tenant.id, quotesAdmin),
    );
    expect(branches.map((branch) => branch.publicId).sort()).toEqual(["loc_quotes_hbz", "loc_quotes_hct"]);
    expect(branches.map((branch) => branch.publicId)).not.toContain("loc_flowers_main");

    const crossUser = await seedMember(quotes.tenant.id, "user@quotes", "user", [quotes.locationA.id]);
    const crossTenant = await runAsRole(sqlClient, "qos_app", () =>
      listPermittedBranches(db, flowers.tenant.id, crossUser),
    );
    expect(crossTenant).toEqual([]);
  });

  it("rejects All branches and unscoped branches for operational posting with the server list", async () => {
    const { quotes } = await seed();
    const user = await seedMember(quotes.tenant.id, "multi@quotes", "user", [
      quotes.locationA.id,
      quotes.locationB.id,
    ]);
    const permitted = await listPermittedBranches(db, quotes.tenant.id, user);

    expect(() => assertOperationalBranch(ALL_BRANCHES, permitted)).toThrow(StaffAuthorizationError);
    expect(() => assertOperationalBranch("loc_flowers_main", permitted)).toThrow(StaffAuthorizationError);
    expect(assertOperationalBranch("loc_quotes_hct", permitted).name).toBe("HCT Academic City");
  });

  it("reports non-members and other tenants as not found, and keeps tenant_inactive for members", async () => {
    const { quotes, flowers } = await seed();
    await seedMember(quotes.tenant.id, "admin@quotes", "administrator");
    await seedMember(flowers.tenant.id, "admin@flowers", "administrator");

    await expect(
      requireBranchContextMembership(db, quotes.tenant.id, "admin@flowers"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      requireBranchContextMembership(db, "not-a-uuid", "admin@quotes"),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      requireBranchContextMembership(db, "00000000-0000-4000-8000-000000000000", "admin@quotes"),
    ).rejects.toMatchObject({ statusCode: 404 });

    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, quotes.tenant.id));
    await expect(
      requireBranchContextMembership(db, quotes.tenant.id, "admin@quotes"),
    ).rejects.toMatchObject({ statusCode: 403, code: "tenant_inactive" });
  });

  it("reads without renaming, creating or reassigning locations", async () => {
    const { quotes } = await seed();
    const admin = await seedMember(quotes.tenant.id, "admin@quotes", "administrator");
    const before = await db.select().from(locations).orderBy(locations.publicId);

    await loadBranchContext(db, quotes.tenant.id, admin);

    expect(await db.select().from(locations).orderBy(locations.publicId)).toEqual(before);
    const [{ count }] = await sqlClient`SELECT count(*)::int AS count FROM qos.tenant_audit_events`;
    expect(count).toBe(0);
  });
});
