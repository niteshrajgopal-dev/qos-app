import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  createDraftProduct,
  updateDraftProduct,
} from "@/lib/catalogue/products";
import {
  approveProductTranslation,
  rejectProductTranslation,
  TranslationApprovalConflictError,
} from "@/lib/catalogue/translation-approval";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { createDraftMenu, MenuError } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue translation approval", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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

    await db.insert(staffMemberships).values({
      tenantId,
      staffIdentityId: identity.id,
      role,
    });

    return {
      membershipId: identity.id,
      role,
      staffIdentityId: identity.id,
    };
  }

  const baseProductInput = {
    internalName: "flat-white",
    translations: {
      en: {
        displayName: "Flat White",
        description: "Double shot with steamed milk.",
      },
      ar: {
        displayName: "فلات وايت",
        description: "شوت مزدوج مع حليب مبخر.",
      },
    },
    defaultVariant: {
      amountMinor: 1800,
      currency: "AED",
    },
  } as const;

  async function approveBothTranslations(
    tenantId: string,
    adminSubject: string,
    productPublicId: string,
    enVersion: number,
    arVersion: number,
  ) {
    await approveProductTranslation(
      db,
      tenantId,
      adminSubject,
      productPublicId,
      "en",
      { expectedTranslationVersion: enVersion },
    );
    await approveProductTranslation(
      db,
      tenantId,
      adminSubject,
      productPublicId,
      "ar",
      { expectedTranslationVersion: arVersion },
    );
  }

  it("rejects non-administrator approval attempts", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const user = await seedStaffMember(
      quotes.tenant.id,
      "user",
      "user.quotes@test",
      "user.quotes@test",
    );
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      user,
      baseProductInput,
    );

    await expect(
      approveProductTranslation(
        db,
        quotes.tenant.id,
        "user.quotes@test",
        product.publicId,
        "ar",
        { expectedTranslationVersion: product.translations.ar.translationVersion },
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const approved = await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      "en",
      { expectedTranslationVersion: product.translations.en.translationVersion },
    );

    expect(approved.translations.en.approvalStatus).toBe("approved");
    expect(approved.translations.en.approvedBySubject).toBe("admin.quotes@test");
    expect(admin.role).toBe("administrator");
  });

  it("returns a conflict when approving a stale translation version", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await updateDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedVersion: product.version,
        translations: {
          en: {
            expectedTranslationVersion: product.translations.en.translationVersion,
            displayName: "Flat White Updated",
          },
        },
      },
    );

    await expect(
      approveProductTranslation(
        db,
        quotes.tenant.id,
        "admin.quotes@test",
        product.publicId,
        "en",
        { expectedTranslationVersion: product.translations.en.translationVersion },
      ),
    ).rejects.toBeInstanceOf(TranslationApprovalConflictError);
  });

  it("invalidates Arabic approval when English source changes", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await approveBothTranslations(
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    const updated = await updateDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedVersion: product.version,
        translations: {
          en: {
            expectedTranslationVersion: product.translations.en.translationVersion,
            displayName: "Flat White Revised",
          },
        },
      },
    );

    expect(updated.translations.en.approvalStatus).toBe("draft");
    expect(updated.translations.ar.approvalStatus).toBe("draft");
  });

  it("blocks menu publish until bilingual translations are approved", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-lunch",
      locationIds: [quotes.location.id],
      translations: {
        en: { displayName: "HBZ Lunch" },
        ar: { displayName: "غداء HBZ" },
      },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: {
            en: { displayName: "Mains" },
            ar: { displayName: "أطباق رئيسية" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await expect(
      publishDraftMenuToLocations(
        db,
        quotes.tenant.id,
        "admin.quotes@test",
        menu.publicId,
        { locationIds: [quotes.location.id] },
      ),
    ).rejects.toBeInstanceOf(MenuError);

    await approveBothTranslations(
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    const published = await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.location.id] },
    );

    expect(published.status).toBe("completed");
    expect(published.sourceVersion).toBe(menu.version);
  });

  it("preserves last approval evidence after reject and text edits", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    const approved = await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      "ar",
      { expectedTranslationVersion: product.translations.ar.translationVersion },
    );

    expect(approved.translations.ar.lastApprovedBySubject).toBe(
      "admin.quotes@test",
    );

    const rejected = await rejectProductTranslation(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      "ar",
      { expectedTranslationVersion: product.translations.ar.translationVersion },
    );

    expect(rejected.translations.ar.approvalStatus).toBe("draft");
    expect(rejected.translations.ar.lastApprovedBySubject).toBe(
      "admin.quotes@test",
    );
  });
});
