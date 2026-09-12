import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  createProductImageUploadGrant,
  ingestProductImageUpload,
  processProductImage,
  ProductMediaError,
  resolvePublicMediaDerivative,
} from "@/lib/media/product-images";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

async function createTestPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

integrationDescribe("product image media", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tempMediaRoot: string;

  const productInput = {
    internalName: "latte",
    translations: {
      en: { displayName: "Latte", description: "Coffee" },
      ar: { displayName: "لاتيه", description: "قهوة" },
    },
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  } as const;

  beforeAll(async () => {
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-media-"));
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(
    tenantId: string,
    subject = "admin.quotes@test",
    email = "admin.quotes@test",
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
        role: "administrator",
      })
      .returning();

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  async function seedUser(tenantId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "user.quotes@test", email: "user.quotes@test" })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "user",
      })
      .returning();

    return {
      membershipId: membership.id,
      role: "user" as const,
      staffIdentityId: identity.id,
    };
  }

  it("uploads, processes, and serves an approved thumbnail derivative", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    const uploaded = await ingestProductImageUpload(
      db,
      quotes.tenant.id,
      product.publicId,
      grant.grantToken,
      pngBytes,
    );

    expect(uploaded.status).toBe("uploaded");

    const processed = await processProductImage(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      grant.assetPublicId,
      "admin.quotes@test",
    );

    expect(processed.status).toBe("approved");
    const thumbnail = processed.derivatives.find(
      (derivative) => derivative.kind === "thumbnail",
    );
    expect(thumbnail?.publicDerivativeId).toMatch(/^mda_/);

    const served = await resolvePublicMediaDerivative(
      db,
      thumbnail!.publicDerivativeId,
    );
    expect(served.contentType).toBe("image/jpeg");
    expect(served.bytes.byteLength).toBeGreaterThan(0);
  });

  it("allows user-role staff to create upload grants", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);
    const user = await seedUser(quotes.tenant.id);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      user,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    expect(grant.grantToken).toBeTruthy();
    expect(grant.uploadPath).toContain(product.publicId);
  });

  it("rejects uploads whose bytes do not match the declared content type", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/jpeg",
      },
    );

    await expect(
      ingestProductImageUpload(
        db,
        quotes.tenant.id,
        product.publicId,
        grant.grantToken,
        pngBytes,
      ),
    ).rejects.toBeInstanceOf(ProductMediaError);
  });

  it("rejects expired upload grants", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    await sqlClient`
      UPDATE qos.catalogue_media_upload_grants
      SET expires_at = now() - interval '1 minute'
      WHERE grant_token = ${grant.grantToken}
    `;

    await expect(
      ingestProductImageUpload(
        db,
        quotes.tenant.id,
        product.publicId,
        grant.grantToken,
        pngBytes,
      ),
    ).rejects.toMatchObject({ statusCode: 410 });
  });

  it("does not resolve public derivatives for unapproved assets", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    await ingestProductImageUpload(
      db,
      quotes.tenant.id,
      product.publicId,
      grant.grantToken,
      pngBytes,
    );

    await expect(
      resolvePublicMediaDerivative(db, "mda_unapproved00001"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns the same derivatives when processing an already approved asset", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    await ingestProductImageUpload(
      db,
      quotes.tenant.id,
      product.publicId,
      grant.grantToken,
      pngBytes,
    );

    const first = await processProductImage(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      grant.assetPublicId,
      "admin.quotes@test",
    );

    const second = await processProductImage(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      grant.assetPublicId,
      "admin.quotes@test",
    );

    expect(second).toEqual(first);
  });

  it("rejects upload grants from another tenant", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const adminQuotes = await seedAdministrator(quotes.tenant.id);
    const adminFlowers = await seedAdministrator(
      flowers.tenant.id,
      "admin.flowers@test",
      "admin.flowers@test",
    );

    const productA = await createDraftProduct(
      db,
      quotes.tenant.id,
      adminQuotes,
      productInput,
    );
    const productB = await createDraftProduct(
      db,
      flowers.tenant.id,
      adminFlowers,
      { ...productInput, internalName: "rose-bouquet" },
    );
    const pngBytes = await createTestPng();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      adminQuotes,
      productA.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    await expect(
      ingestProductImageUpload(
        db,
        flowers.tenant.id,
        productB.publicId,
        grant.grantToken,
        pngBytes,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
