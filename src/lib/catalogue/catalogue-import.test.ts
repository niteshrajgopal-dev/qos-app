import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogueImportSourceLinks,
  catalogueMediaAssets,
  catalogueProducts,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import {
  applyCatalogueImport,
  previewCatalogueImport,
} from "@/lib/catalogue/catalogue-import";
import { CATALOGUE_IMPORT_SAMPLE_CSV } from "@/lib/catalogue/catalogue-import-sample";
import { createDraftMenu } from "@/lib/catalogue/menus";
import {
  getCustomerMenuPayload,
  publishDraftMenuToLocations,
} from "@/lib/catalogue/menu-publish";
import { getDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { eq } from "drizzle-orm";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const IMAGE_IMPORT_CSV = `source_id,internal_name,display_name_en,display_name_ar,amount_minor,currency,image_url
674cb5ee372f00d7a436e1e8,cream-espresso,Cream Espresso,كريم اسبريسو,3700,AED,https://media.finedinemenu.com/MawZBMZR_/ae2ec51a-5128-4109-a4d9-418421621d47.jpeg
flatwhite-no-image,flatwhite,Flatwhite,فلات وايت,1800,AED,
`;

integrationDescribe("catalogue import", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tempMediaRoot: string;

  beforeAll(async () => {
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-import-media-"));
    setMediaStorage(new LocalMediaStorage(tempMediaRoot));

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    setMediaStorage(null);
    await sqlClient.end({ timeout: 5 });
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedStaffMember(
    tenantId: string,
    role: "administrator" | "user",
    subject: string,
    email: string,
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role,
      })
      .returning();

    return {
      membershipId: membership.id,
      role,
      staffIdentityId: identity.id,
    };
  }

  it("previews and applies synthetic CSV without duplicate creates on replay", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import@test",
      "admin.import@test",
    );

    const preview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-001",
      },
    );

    expect(preview.preview.createCount).toBe(3);
    expect(preview.preview.errorCount).toBe(0);

    const apply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        operationPublicId: preview.operationPublicId,
        previewHash: preview.previewHash,
        idempotencyKey: "preview-001",
      },
    );

    expect(apply.replayed).toBe(false);
    expect(apply.report.createCount).toBe(3);
    expect(apply.report.errorCount).toBe(0);

    const replay = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        operationPublicId: preview.operationPublicId,
        previewHash: preview.previewHash,
        idempotencyKey: "preview-001",
      },
    );

    expect(replay.replayed).toBe(true);
    expect(replay.report.createCount).toBe(3);

    const replayPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-001",
      },
    );

    expect(replayPreview.replayed).toBe(true);
    expect(replayPreview.operationPublicId).toBe(preview.operationPublicId);

    const secondPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-002",
      },
    );

    expect(secondPreview.preview.createCount).toBe(0);
    expect(secondPreview.preview.unchangedCount).toBe(3);
  });

  it("ingests image_url during apply and exposes mediaAssetId on published menus", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import-images@test",
      "admin.import-images@test",
    );

    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: admin.membershipId,
      locationId: quotes.locationA.id,
    });

    const pngBytes = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .png()
      .toBuffer();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(pngBytes, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(pngBytes.byteLength),
        },
      }),
    );

    const preview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-images@test",
      {
        fileName: "hbz-images.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.images",
        idempotencyKey: "preview-images-001",
      },
    );

    expect(preview.preview.createCount).toBe(2);
    expect(
      preview.preview.rows.find((row) => row.sourceId === "674cb5ee372f00d7a436e1e8")
        ?.ingestImage,
    ).toBe(true);
    expect(
      preview.preview.rows.find((row) => row.sourceId === "flatwhite-no-image")
        ?.ingestImage,
    ).toBe(false);

    const apply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-images@test",
      {
        operationPublicId: preview.operationPublicId,
        previewHash: preview.previewHash,
        idempotencyKey: "preview-images-001",
      },
    );

    expect(apply.report.errorCount).toBe(0);
    expect(apply.report.createCount).toBe(2);

    const creamRow = apply.report.rows.find(
      (row) => row.sourceId === "674cb5ee372f00d7a436e1e8",
    );
    expect(creamRow?.productPublicId).toBeTruthy();

    const [creamProduct] = await db
      .select({ primaryMediaAssetId: catalogueProducts.primaryMediaAssetId })
      .from(catalogueProducts)
      .where(eq(catalogueProducts.publicId, creamRow!.productPublicId!))
      .limit(1);

    expect(creamProduct?.primaryMediaAssetId).toBeTruthy();

    const flatwhiteRow = apply.report.rows.find(
      (row) => row.sourceId === "flatwhite-no-image",
    );
    const [flatwhiteProduct] = await db
      .select({ primaryMediaAssetId: catalogueProducts.primaryMediaAssetId })
      .from(catalogueProducts)
      .where(eq(catalogueProducts.publicId, flatwhiteRow!.productPublicId!))
      .limit(1);

    expect(flatwhiteProduct?.primaryMediaAssetId).toBeNull();

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-image-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "HBZ Image Menu" },
        ar: { displayName: "قائمة" },
      },
      sections: [
        {
          internalName: "signature",
          sortOrder: 0,
          translations: {
            en: { displayName: "Signature" },
            ar: { displayName: "مميز" },
          },
          products: [{ productPublicId: creamRow!.productPublicId!, sortOrder: 0 }],
        },
      ],
    });

    const creamDraft = await getDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      creamRow!.productPublicId!,
    );

    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.import-images@test",
      creamRow!.productPublicId!,
      "en",
      {
        expectedTranslationVersion: creamDraft.translations.en.translationVersion,
      },
    );
    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.import-images@test",
      creamRow!.productPublicId!,
      "ar",
      {
        expectedTranslationVersion: creamDraft.translations.ar.translationVersion,
      },
    );

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.import-images@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const live = await getCustomerMenuPayload(
      db,
      quotes.tenant.id,
      menu.publicId,
      quotes.locationA.publicId,
    );

    expect(live?.sections[0]?.products[0]?.mediaAssetId).toBeTruthy();
    expect(live?.sections[0]?.products[0]?.translations.en.displayName).toBe(
      "Cream Espresso",
    );
  });

  it("force-image-reingest uploads again when primaryMediaAssetId is already set", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import-force@test",
      "admin.import-force@test",
    );
    const pngBytes = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 4, g: 5, b: 6 },
      },
    })
      .png()
      .toBuffer();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(pngBytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(pngBytes.byteLength),
          },
        }),
    );

    const firstPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-force@test",
      {
        fileName: "hbz-force.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.force",
        idempotencyKey: "preview-force-001",
      },
    );
    const firstApply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-force@test",
      {
        operationPublicId: firstPreview.operationPublicId,
        previewHash: firstPreview.previewHash,
        idempotencyKey: "preview-force-001",
      },
    );

    expect(firstApply.report.createCount).toBe(2);
    expect(firstApply.report.errorCount).toBe(0);
    expect(firstApply.report.media?.uploaded).toBe(1);

    const productsAfterFirst = await db.select().from(catalogueProducts);
    const creamAfterFirst = productsAfterFirst.find(
      (product) => product.internalName === "cream-espresso",
    );
    const firstPrimary = creamAfterFirst?.primaryMediaAssetId;
    expect(firstPrimary).toBeTruthy();
    expect(
      productsAfterFirst.find((product) => product.internalName === "flatwhite")
        ?.primaryMediaAssetId,
    ).toBeNull();

    const fetchCountAfterFirst = fetchMock.mock.calls.length;
    expect(fetchCountAfterFirst).toBeGreaterThan(0);

    const skipPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-force@test",
      {
        fileName: "hbz-force.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.force",
        idempotencyKey: "preview-force-002",
      },
    );
    const creamSkip = skipPreview.preview.rows.find(
      (row) => row.sourceId === "674cb5ee372f00d7a436e1e8",
    );
    const flatwhiteSkip = skipPreview.preview.rows.find(
      (row) => row.sourceId === "flatwhite-no-image",
    );
    expect(creamSkip?.ingestImage).toBe(false);
    expect(flatwhiteSkip?.ingestImage).toBe(false);

    const skipApply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-force@test",
      {
        operationPublicId: skipPreview.operationPublicId,
        previewHash: skipPreview.previewHash,
        idempotencyKey: "preview-force-002",
      },
    );

    expect(skipApply.report.media?.alreadyPresent).toBe(1);
    expect(skipApply.report.media?.uploaded).toBe(0);
    expect(fetchMock.mock.calls.length).toBe(fetchCountAfterFirst);

    const forcePreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-force@test",
      {
        fileName: "hbz-force.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.force",
        idempotencyKey: "preview-force-003",
        forceImageReingest: true,
      },
    );
    const creamForce = forcePreview.preview.rows.find(
      (row) => row.sourceId === "674cb5ee372f00d7a436e1e8",
    );
    const flatwhiteForce = forcePreview.preview.rows.find(
      (row) => row.sourceId === "flatwhite-no-image",
    );
    expect(creamForce?.ingestImage).toBe(true);
    expect(flatwhiteForce?.ingestImage).toBe(false);

    const forceApply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-force@test",
      {
        operationPublicId: forcePreview.operationPublicId,
        previewHash: forcePreview.previewHash,
        idempotencyKey: "preview-force-003",
        forceImageReingest: true,
      },
    );

    expect(forceApply.report.errorCount).toBe(0);
    expect(forceApply.report.media?.alreadyPresent).toBe(0);
    expect(forceApply.report.media?.uploaded).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchCountAfterFirst);

    const productsAfterForce = await db.select().from(catalogueProducts);
    const creamAfterForce = productsAfterForce.find(
      (product) => product.internalName === "cream-espresso",
    );
    expect(creamAfterForce?.primaryMediaAssetId).toBeTruthy();
    expect(creamAfterForce?.primaryMediaAssetId).not.toBe(firstPrimary);
    expect(
      productsAfterForce.find((product) => product.internalName === "flatwhite")
        ?.primaryMediaAssetId,
    ).toBeNull();
    expect(await db.select().from(catalogueMediaAssets)).toHaveLength(2);
    expect(await db.select().from(catalogueImportSourceLinks)).toHaveLength(2);
  });

  it("repairs missing imported images on unchanged reruns without duplicating media", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import-repair@test",
      "admin.import-repair@test",
    );
    const pngBytes = await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 3,
        background: { r: 90, g: 10, b: 10 },
      },
    })
      .png()
      .toBuffer();

    const failingFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            status: 413,
            code: "TooLargeImageException",
            message: "The converted image is too large to return.",
          }),
          {
            status: 413,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const firstPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-repair@test",
      {
        fileName: "hbz-repair.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.repair",
        idempotencyKey: "preview-repair-001",
      },
    );
    const firstApply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-repair@test",
      {
        operationPublicId: firstPreview.operationPublicId,
        previewHash: firstPreview.previewHash,
        idempotencyKey: "preview-repair-001",
      },
    );

    expect(firstApply.report.createCount).toBe(1);
    expect(firstApply.report.errorCount).toBe(1);
    expect(firstApply.report.errorCategories?.["finedine-http-413"]).toBe(1);

    const productsAfterFailure = await db.select().from(catalogueProducts);
    expect(productsAfterFailure).toHaveLength(2);
    expect(
      productsAfterFailure.filter((product) => product.primaryMediaAssetId)
        .length,
    ).toBe(0);

    failingFetch.mockRestore();
    const successFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(pngBytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(pngBytes.byteLength),
          },
        }),
    );

    const repairPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-repair@test",
      {
        fileName: "hbz-repair.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.repair",
        idempotencyKey: "preview-repair-002",
      },
    );

    const creamPreview = repairPreview.preview.rows.find(
      (row) => row.sourceId === "674cb5ee372f00d7a436e1e8",
    );
    expect(creamPreview?.status).toBe("unchanged");
    expect(creamPreview?.ingestImage).toBe(true);

    const repairApply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-repair@test",
      {
        operationPublicId: repairPreview.operationPublicId,
        previewHash: repairPreview.previewHash,
        idempotencyKey: "preview-repair-002",
      },
    );

    expect(repairApply.report.createCount).toBe(0);
    expect(repairApply.report.updateCount).toBe(0);
    expect(repairApply.report.unchangedCount).toBe(2);
    expect(repairApply.report.errorCount).toBe(0);
    expect(repairApply.report.media?.repaired).toBe(1);
    expect(repairApply.report.media?.uploaded).toBe(0);

    const productsAfterRepair = await db.select().from(catalogueProducts);
    const assetsAfterRepair = await db.select().from(catalogueMediaAssets);
    const linksAfterRepair = await db.select().from(catalogueImportSourceLinks);

    expect(productsAfterRepair).toHaveLength(2);
    expect(linksAfterRepair).toHaveLength(2);
    expect(assetsAfterRepair).toHaveLength(1);
    expect(
      productsAfterRepair.find((product) => product.internalName === "cream-espresso")
        ?.primaryMediaAssetId,
    ).toBeTruthy();

    const fetchCountAfterRepair = successFetch.mock.calls.length;

    const rerunPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-repair@test",
      {
        fileName: "hbz-repair.csv",
        bytes: Buffer.from(IMAGE_IMPORT_CSV, "utf8"),
        connectionKey: "quotes.hbz.repair",
        idempotencyKey: "preview-repair-003",
      },
    );
    const creamRerun = rerunPreview.preview.rows.find(
      (row) => row.sourceId === "674cb5ee372f00d7a436e1e8",
    );
    expect(creamRerun?.status).toBe("unchanged");
    expect(creamRerun?.ingestImage).toBe(false);

    const rerunApply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-repair@test",
      {
        operationPublicId: rerunPreview.operationPublicId,
        previewHash: rerunPreview.previewHash,
        idempotencyKey: "preview-repair-003",
      },
    );

    expect(rerunApply.report.media?.alreadyPresent).toBe(1);
    expect(rerunApply.report.media?.repaired).toBe(0);
    expect(successFetch.mock.calls.length).toBe(fetchCountAfterRepair);
    expect(await db.select().from(catalogueProducts)).toHaveLength(2);
    expect(await db.select().from(catalogueImportSourceLinks)).toHaveLength(2);
    expect(await db.select().from(catalogueMediaAssets)).toHaveLength(1);
  });

  it("keeps a successful product update when image ingest fails and repairs it next run", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import-update-repair@test",
      "admin.import-update-repair@test",
    );
    const pngBytes = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();

    const seedCsv = `source_id,internal_name,display_name_en,display_name_ar,amount_minor,currency,image_url
update-later,flatwhite,Flatwhite,فلات وايت,1800,AED,
`;
    const updatedCsv = `source_id,internal_name,display_name_en,display_name_ar,amount_minor,currency,image_url
update-later,flatwhite-updated,Flatwhite Updated,فلات وايت,1900,AED,https://media.finedinemenu.com/MawZBMZR_/ae2ec51a-5128-4109-a4d9-418421621d47.jpeg
`;

    const seedPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-update-repair@test",
      {
        fileName: "seed.csv",
        bytes: Buffer.from(seedCsv, "utf8"),
        connectionKey: "quotes.hbz.update-repair",
        idempotencyKey: "preview-update-repair-001",
      },
    );
    await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-update-repair@test",
      {
        operationPublicId: seedPreview.operationPublicId,
        previewHash: seedPreview.previewHash,
        idempotencyKey: "preview-update-repair-001",
      },
    );

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("Key based authentication is not permitted on this storage account.", {
          status: 500,
        }),
    );

    const updatePreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-update-repair@test",
      {
        fileName: "updated.csv",
        bytes: Buffer.from(updatedCsv, "utf8"),
        connectionKey: "quotes.hbz.update-repair",
        idempotencyKey: "preview-update-repair-002",
      },
    );
    expect(updatePreview.preview.updateCount).toBe(1);

    const failedUpdate = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-update-repair@test",
      {
        operationPublicId: updatePreview.operationPublicId,
        previewHash: updatePreview.previewHash,
        idempotencyKey: "preview-update-repair-002",
      },
    );

    expect(failedUpdate.report.errorCount).toBe(1);
    const [updatedProduct] = await db.select().from(catalogueProducts);
    expect(updatedProduct.internalName).toBe("flatwhite-updated");
    expect(updatedProduct.primaryMediaAssetId).toBeNull();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(pngBytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(pngBytes.byteLength),
          },
        }),
    );

    const repairPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-update-repair@test",
      {
        fileName: "updated.csv",
        bytes: Buffer.from(updatedCsv, "utf8"),
        connectionKey: "quotes.hbz.update-repair",
        idempotencyKey: "preview-update-repair-003",
      },
    );
    expect(repairPreview.preview.unchangedCount).toBe(1);
    expect(repairPreview.preview.rows[0]?.ingestImage).toBe(true);

    const repaired = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import-update-repair@test",
      {
        operationPublicId: repairPreview.operationPublicId,
        previewHash: repairPreview.previewHash,
        idempotencyKey: "preview-update-repair-003",
      },
    );

    expect(repaired.report.errorCount).toBe(0);
    expect(repaired.report.media?.repaired).toBe(1);
    expect(await db.select().from(catalogueProducts)).toHaveLength(1);
    expect(await db.select().from(catalogueImportSourceLinks)).toHaveLength(1);
    expect(await db.select().from(catalogueMediaAssets)).toHaveLength(1);
    const [repairedProduct] = await db.select().from(catalogueProducts);
    expect(repairedProduct.primaryMediaAssetId).toBeTruthy();
  });
});
