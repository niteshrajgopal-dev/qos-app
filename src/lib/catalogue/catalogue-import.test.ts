import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
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
});
