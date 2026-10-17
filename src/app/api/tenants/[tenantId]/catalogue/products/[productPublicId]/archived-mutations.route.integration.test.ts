import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRuns,
  aiJobs,
  catalogueMediaUploadGrants,
  catalogueProducts,
  catalogueVariants,
  staffIdentities,
  staffMemberships,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE } from "@/lib/catalogue/product-mutation-policy";
import {
  archiveDraftProduct,
  createDraftProduct,
} from "@/lib/catalogue/products";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { POST as postDescriptionAccept } from "./description/ai/accept/route";
import { POST as postDescriptionReject } from "./description/ai/reject/route";
import { POST as postDescriptionRequest } from "./description/ai/request/route";
import { PUT as putLocationPrice } from "./locations/[locationPublicId]/price/route";
import { POST as resetLocationPrice } from "./locations/[locationPublicId]/price/reset/route";
import { POST as postMediaProcess } from "./media/process/route";
import { POST as postImageUploadGrant } from "./media/upload-grants/route";
import { POST as postVideoUploadGrant } from "./media/videos/upload-grants/route";
import { POST as postVideoQueue } from "./media/videos/queue/route";
import { POST as postModifierAttach } from "./modifier-groups/route";
import { PATCH as patchProduct } from "./route";
import { POST as postTranslationAccept } from "./translations/ai/accept/route";
import { POST as postTranslationReject } from "./translations/ai/reject/route";
import { POST as postTranslationRequest } from "./translations/ai/request/route";
import { POST as approveTranslation } from "./translations/[locale]/approve/route";
import { POST as rejectTranslation } from "./translations/[locale]/reject/route";
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
    await sqlClient`TRUNCATE TABLE qos.agent_run_catalogue_description_decisions, qos.agent_run_catalogue_translation_decisions, qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.agent_run_inputs, qos.agent_runs, qos.catalogue_media_upload_grants, qos.tenant_audit_events, qos.catalogue_variant_location_price_overrides, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
      locationPublicId: "loc_quotes_hbz",
    };
  }

  const FAKE_RUN_PUBLIC_ID = `run_${"a".repeat(24)}`;

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

  async function snapshotSideEffectTables(tenantId: string) {
    const grants = await db
      .select()
      .from(catalogueMediaUploadGrants)
      .where(eq(catalogueMediaUploadGrants.tenantId, tenantId));
    const runs = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.tenantId, tenantId));
    const jobs = await db
      .select()
      .from(aiJobs)
      .where(eq(aiJobs.tenantId, tenantId));

    return { grants, runs, jobs };
  }

  async function expectArchivedMutation(
    response: Response,
    label: string,
  ) {
    expect(response.status, label).toBe(409);
    expect(await response.json()).toMatchObject({
      code: CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    });
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

  it("returns 409 product_archived for remaining editor child mutations without side effects", async () => {
    const {
      tenantId,
      productPublicId,
      locationPublicId,
    } = await seedArchivedProduct();
    staffMocks.requireStaffIdentity.mockResolvedValue({
      subject: ADMIN_SUBJECT,
      email: ADMIN_SUBJECT,
    });

    const beforeProduct = await snapshotProductState(tenantId, productPublicId);
    const beforeSideEffects = await snapshotSideEffectTables(tenantId);

    await expectArchivedMutation(
      await putLocationPrice(
        new Request("http://localhost/price", {
          method: "PUT",
          body: JSON.stringify({ amountMinor: 1500 }),
        }),
        {
          params: Promise.resolve({
            tenantId,
            productPublicId,
            locationPublicId,
          }),
        },
      ),
      "location price PUT",
    );

    await expectArchivedMutation(
      await resetLocationPrice(
        new Request("http://localhost/price/reset", { method: "POST" }),
        {
          params: Promise.resolve({
            tenantId,
            productPublicId,
            locationPublicId,
          }),
        },
      ),
      "location price reset",
    );

    await expectArchivedMutation(
      await postImageUploadGrant(
        new Request("http://localhost/media/upload-grants", {
          method: "POST",
          body: JSON.stringify({
            expectedByteSize: 1024,
            expectedContentType: "image/png",
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "image upload grant",
    );

    await expectArchivedMutation(
      await postMediaProcess(
        new Request("http://localhost/media/process", {
          method: "POST",
          body: JSON.stringify({ assetPublicId: "mas_deadbeef00000000" }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "image process",
    );

    await expectArchivedMutation(
      await postVideoUploadGrant(
        new Request("http://localhost/media/videos/upload-grants", {
          method: "POST",
          body: JSON.stringify({
            byteSize: 1024,
            contentType: "video/mp4",
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "video upload grant",
    );

    await expectArchivedMutation(
      await postVideoQueue(
        new Request("http://localhost/media/videos/queue", {
          method: "POST",
          body: JSON.stringify({ assetPublicId: "mas_deadbeef00000001" }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "video queue",
    );

    await expectArchivedMutation(
      await approveTranslation(
        new Request("http://localhost/translations/en/approve", {
          method: "POST",
          body: JSON.stringify({ expectedTranslationVersion: 1 }),
        }),
        {
          params: Promise.resolve({
            tenantId,
            productPublicId,
            locale: "en",
          }),
        },
      ),
      "translation approve",
    );

    await expectArchivedMutation(
      await rejectTranslation(
        new Request("http://localhost/translations/en/reject", {
          method: "POST",
          body: JSON.stringify({ expectedTranslationVersion: 1 }),
        }),
        {
          params: Promise.resolve({
            tenantId,
            productPublicId,
            locale: "en",
          }),
        },
      ),
      "translation reject",
    );

    await expectArchivedMutation(
      await postTranslationRequest(
        new Request("http://localhost/translations/ai/request", {
          method: "POST",
          body: JSON.stringify({
            sourceLocale: "en",
            targetLocale: "ar",
            idempotencyKey: "idem-archived-test-01",
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "translation AI request",
    );

    await expectArchivedMutation(
      await postTranslationAccept(
        new Request("http://localhost/translations/ai/accept", {
          method: "POST",
          body: JSON.stringify({
            runPublicId: FAKE_RUN_PUBLIC_ID,
            displayName: "Test",
            description: null,
            expectedTargetTranslationVersion: 1,
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "translation AI accept",
    );

    await expectArchivedMutation(
      await postTranslationReject(
        new Request("http://localhost/translations/ai/reject", {
          method: "POST",
          body: JSON.stringify({ runPublicId: FAKE_RUN_PUBLIC_ID }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "translation AI reject",
    );

    await expectArchivedMutation(
      await postDescriptionRequest(
        new Request("http://localhost/description/ai/request", {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: "idem-archived-desc-01",
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "description AI request",
    );

    await expectArchivedMutation(
      await postDescriptionAccept(
        new Request("http://localhost/description/ai/accept", {
          method: "POST",
          body: JSON.stringify({
            runPublicId: FAKE_RUN_PUBLIC_ID,
            description: "New text",
            expectedSourceTranslationVersion: 1,
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "description AI accept",
    );

    await expectArchivedMutation(
      await postDescriptionReject(
        new Request("http://localhost/description/ai/reject", {
          method: "POST",
          body: JSON.stringify({ runPublicId: FAKE_RUN_PUBLIC_ID }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "description AI reject",
    );

    await expectArchivedMutation(
      await postModifierAttach(
        new Request("http://localhost/modifier-groups", {
          method: "POST",
          body: JSON.stringify({
            expectedProductVersion: beforeProduct.product!.version,
            modifierGroupPublicId: "modgrp_nonexistent",
          }),
        }),
        { params: Promise.resolve({ tenantId, productPublicId }) },
      ),
      "modifier attach",
    );

    const afterProduct = await snapshotProductState(tenantId, productPublicId);
    const afterSideEffects = await snapshotSideEffectTables(tenantId);
    expect(afterProduct).toEqual(beforeProduct);
    expect(afterSideEffects).toEqual(beforeSideEffects);
  });
});
