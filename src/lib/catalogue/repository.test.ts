import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import { listCatalogueProductSummaries } from "@/lib/catalogue/repository";
import {
  createProductImageUploadGrant,
  ingestProductImageUpload,
  processProductImage,
} from "@/lib/media/product-images";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("listCatalogueProductSummaries", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tempMediaRoot: string;

  beforeAll(async () => {
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-media-"));
    setMediaStorage(new LocalMediaStorage(tempMediaRoot));

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    setMediaStorage(null);
    await sqlClient.end({ timeout: 5 });
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(tenantId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "admin.quotes@test",
        email: "admin.quotes@test",
      })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "administrator",
      })
      .returning();

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  it("includes the approved thumbnail public id used by the storefront", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);

    const withImage = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "latte",
      translations: {
        en: { displayName: "Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const withoutImage = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "tea",
      translations: {
        en: { displayName: "Tea", description: "Tea" },
        ar: { displayName: "شاي", description: "شاي" },
      },
      defaultVariant: { amountMinor: 1200, currency: "AED" },
    });

    const pngBytes = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      withImage.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );
    await ingestProductImageUpload(
      db,
      quotes.tenant.id,
      withImage.publicId,
      grant.grantToken,
      pngBytes,
    );
    const processed = await processProductImage(
      db,
      quotes.tenant.id,
      admin,
      withImage.publicId,
      grant.assetPublicId,
      "admin.quotes@test",
    );
    const thumbnailId = processed.derivatives.find(
      (derivative) => derivative.kind === "thumbnail",
    )?.publicDerivativeId;

    const summaries = await listCatalogueProductSummaries(db, quotes.tenant.id);

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          publicId: withImage.publicId,
          thumbnailPublicId: thumbnailId,
        }),
        expect.objectContaining({
          publicId: withoutImage.publicId,
          thumbnailPublicId: null,
        }),
      ]),
    );
  });
});
