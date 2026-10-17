import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { POST } from "./route";

const staffMocks = vi.hoisted(() => ({
  requireStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return {
    ...actual,
    requireStaffIdentity: staffMocks.requireStaffIdentity,
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN_SUBJECT = "admin.archive-route@test";
const USER_SUBJECT = "user.archive-route@test";

integrationDescribe("POST /catalogue/products/[productPublicId]/archive (DB)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedTenantWithRoles() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    const [adminIdentity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: ADMIN_SUBJECT, email: ADMIN_SUBJECT })
      .returning();
    await db.insert(staffMemberships).values({
      tenantId: quotes.tenant.id,
      staffIdentityId: adminIdentity.id,
      role: "administrator",
    });

    const [userIdentity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: USER_SUBJECT, email: USER_SUBJECT })
      .returning();
    await db.insert(staffMemberships).values({
      tenantId: quotes.tenant.id,
      staffIdentityId: userIdentity.id,
      role: "user",
    });

    const adminMembership = {
      membershipId: adminIdentity.id,
      role: "administrator" as const,
      staffIdentityId: adminIdentity.id,
    };

    const product = await createDraftProduct(db, quotes.tenant.id, adminMembership, {
      internalName: "archive-route-product",
      translations: {
        en: { displayName: "Archive Route", description: null },
        ar: { displayName: "أرشفة", description: null },
      },
      defaultVariant: { amountMinor: 1000, currency: "AED" },
    });

    return { tenantId: quotes.tenant.id, productPublicId: product.publicId };
  }

  it("returns 403 for read-only staff users", async () => {
    const { tenantId, productPublicId } = await seedTenantWithRoles();
    staffMocks.requireStaffIdentity.mockResolvedValue({
      subject: USER_SUBJECT,
      email: USER_SUBJECT,
    });

    const response = await POST(
      new Request("http://localhost/archive", { method: "POST" }),
      {
        params: Promise.resolve({ tenantId, productPublicId }),
      },
    );

    expect(response.status).toBe(403);
  });
});
