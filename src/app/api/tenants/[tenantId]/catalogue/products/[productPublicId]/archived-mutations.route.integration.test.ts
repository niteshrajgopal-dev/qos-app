import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogueProducts, catalogueVariants, staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE } from "@/lib/catalogue/product-mutation-policy";
import {
  archiveDraftProduct,
  createDraftProduct,
} from "@/lib/catalogue/products";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { PATCH as patchProduct } from "./route";
import { POST as postVariant } from "./variants/route";
import { PATCH as patchVariant } from "./variants/[variantPublicId]/route";
import { PATCH as reorderVariants } from "./variants/reorder/route";

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

const ADMIN_SUBJECT = "admin.archived-mutations@test";
const USER_SUBJECT = "user.archived-mutations@test";

integrationDescribe("archived catalogue product child mutations (DB routes)", () => {
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

  async function seedArchivedProduct() {
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
      internalName: "archived-mutation-product",
      translations: {
        en: { displayName: "Archived Mutation", description: null },
        ar: { displayName: "مؤرشف", description: null },
      },
      defaultVariant: { amountMinor: 1000, currency: "AED" },
    });

    const archived = await archiveDraftProduct(
      db,
      quotes.tenant.id,
      product.publicId,
      ADMIN_SUBJECT,
    );

    return {
      tenantId: quotes.tenant.id,
      productPublicId: product.publicId,
      variantPublicId: product.defaultVariant.publicId,
      productVersion: archived.version,
    };
  }

  async function snapshotProductState(tenantId: string, productPublicId: string) {
    const [product] = await db
      .select()
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.publicId, productPublicId),
        ),
      );
    const variants = await db
      .select()
      .from(catalogueVariants)
      .where(eq(catalogueVariants.productId, product!.id));

    return { product, variants };
  }

  it("returns 409 product_archived for variant create, update, reorder, and product patch without DB writes", async () => {
    const {
      tenantId,
      productPublicId,
      variantPublicId,
      productVersion,
    } = await seedArchivedProduct();
    staffMocks.requireStaffIdentity.mockResolvedValue({
      subject: ADMIN_SUBJECT,
      email: ADMIN_SUBJECT,
    });

    const before = await snapshotProductState(tenantId, productPublicId);

    const createResponse = await postVariant(
      new Request("http://localhost/variants", {
        method: "POST",
        body: JSON.stringify({
          expectedProductVersion: productVersion,
          translations: {
            en: { displayName: "Large" },
            ar: { displayName: "كبير" },
          },
        }),
      }),
      { params: Promise.resolve({ tenantId, productPublicId }) },
    );
    expect(createResponse.status).toBe(409);
    expect(await createResponse.json()).toMatchObject({
      code: CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    });

    const patchVariantResponse = await patchVariant(
      new Request("http://localhost/variants/patch", {
        method: "PATCH",
        body: JSON.stringify({
          expectedProductVersion: productVersion,
          translations: {
            en: { displayName: "Changed" },
            ar: { displayName: "تغيير" },
          },
        }),
      }),
      {
        params: Promise.resolve({
          tenantId,
          productPublicId,
          variantPublicId,
        }),
      },
    );
    expect(patchVariantResponse.status).toBe(409);
    expect(await patchVariantResponse.json()).toMatchObject({
      code: CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    });

    const reorderResponse = await reorderVariants(
      new Request("http://localhost/variants/reorder", {
        method: "PATCH",
        body: JSON.stringify({
          expectedProductVersion: productVersion,
          orderedPublicIds: [variantPublicId],
        }),
      }),
      { params: Promise.resolve({ tenantId, productPublicId }) },
    );
    expect(reorderResponse.status).toBe(409);
    expect(await reorderResponse.json()).toMatchObject({
      code: CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    });

    const patchProductResponse = await patchProduct(
      new Request("http://localhost/product", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: productVersion,
          internalName: "should-not-persist",
        }),
      }),
      { params: Promise.resolve({ tenantId, productPublicId }) },
    );
    expect(patchProductResponse.status).toBe(409);
    expect(await patchProductResponse.json()).toMatchObject({
      code: CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    });

    const after = await snapshotProductState(tenantId, productPublicId);
    expect(after).toEqual(before);
  });

  it("returns 403 when read-only staff attempt variant price changes on archived products", async () => {
    const {
      tenantId,
      productPublicId,
      variantPublicId,
      productVersion,
    } = await seedArchivedProduct();
    staffMocks.requireStaffIdentity.mockResolvedValue({
      subject: USER_SUBJECT,
      email: USER_SUBJECT,
    });

    const response = await patchVariant(
      new Request("http://localhost/variants/patch", {
        method: "PATCH",
        body: JSON.stringify({
          expectedProductVersion: productVersion,
          amountMinor: 2500,
        }),
      }),
      {
        params: Promise.resolve({
          tenantId,
          productPublicId,
          variantPublicId,
        }),
      },
    );

    expect(response.status).toBe(403);
  });
});
