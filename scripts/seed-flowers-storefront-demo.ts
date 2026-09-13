import { and, eq } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import {
  catalogueProductTranslations,
  catalogueProducts,
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontDomains,
  storefrontLocations,
  storefronts,
  tenants,
} from "@/db/schema";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { seedFlowerDevTenant } from "@/lib/seed/dev-tenants";
import { FLOWER_TENANT_PUBLIC_ID } from "@/lib/seed/constants";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
} from "@/lib/storefront/storefronts";

const FLOWERS_HOSTNAME = "flowers.dev.qosapp.com";
const SEED_ACTOR = "seed.flowers-storefront@qosapp.com";

async function ensureStaffAdmin(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  locationId: string,
) {
  const subject = SEED_ACTOR;

  const [existingIdentity] = await db
    .select()
    .from(staffIdentities)
    .where(eq(staffIdentities.providerSubject, subject))
    .limit(1);

  const identity =
    existingIdentity ??
    (
      await db
        .insert(staffIdentities)
        .values({ providerSubject: subject, email: subject })
        .returning()
    )[0];

  const [existingMembership] = await db
    .select()
    .from(staffMemberships)
    .where(eq(staffMemberships.staffIdentityId, identity.id))
    .limit(1);

  const membership =
    existingMembership ??
    (
      await db
        .insert(staffMemberships)
        .values({
          tenantId,
          staffIdentityId: identity.id,
          role: "administrator",
        })
        .returning()
    )[0];

  await db
    .insert(staffLocationScopes)
    .values({
      tenantId,
      staffMembershipId: membership.id,
      locationId,
    })
    .onConflictDoNothing();

  return {
    membershipId: membership.id,
    role: "administrator" as const,
    staffIdentityId: identity.id,
  };
}

async function ensureFlowerStorefront(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  locationPublicId: string,
) {
  const fixture = flowerTenantFixture();

  const [existingDomain] = await db
    .select()
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, FLOWERS_HOSTNAME))
    .limit(1);

  if (existingDomain) {
    const [storefront] = await db
      .select()
      .from(storefronts)
      .where(eq(storefronts.id, existingDomain.storefrontId))
      .limit(1);

    if (!storefront) {
      throw new Error("Flowers domain exists but storefront row is missing.");
    }

    return storefront;
  }

  const storefront = await createStorefront(db, tenantId, {
    brandPublicId: fixture.brand.publicId,
    internalName: "flowers-dev-storefront",
    slug: "flowers",
    defaultLocale: "en",
    supportedLocales: ["en", "ar"],
    draftConfig: defaultStorefrontDraftConfig("generic_retail"),
    locationPublicIds: [locationPublicId],
  });

  await registerStorefrontDomain(db, tenantId, storefront.publicId, {
    hostname: FLOWERS_HOSTNAME,
    domainType: "platform_subdomain",
    lifecycleStatus: "active",
    isPrimary: true,
  });

  return storefront;
}

async function main() {
  const { db, sql } = createDbClient();
  const flowers = await seedFlowerDevTenant(db);

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.publicId, FLOWER_TENANT_PUBLIC_ID))
    .limit(1);

  if (!tenant) {
    throw new Error("Flower tenant seed failed.");
  }

  const locationPublicId = flowerTenantFixture().location.publicId;

  const [location] = await db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenant.id),
        eq(locations.publicId, locationPublicId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new Error(`Flower location not found: ${locationPublicId}`);
  }

  const admin = await ensureStaffAdmin(db, tenant.id, location.id);
  const storefront = await ensureFlowerStorefront(db, tenant.id, locationPublicId);
  const productPublicId = flowerRoseBouquetFixture.productPublicId;

  const [product] = await db
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenant.id),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);

  if (!product) {
    throw new Error(`Flower product not found: ${productPublicId}`);
  }

  const translations = await db
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenant.id),
        eq(catalogueProductTranslations.productId, product.id),
      ),
    );

  for (const locale of ["en", "ar"] as const) {
    const translation = translations.find((row) => row.locale === locale);
    if (!translation) {
      throw new Error(`Missing ${locale} translation for ${productPublicId}`);
    }

    if (translation.approvalStatus === "approved") {
      continue;
    }

    await approveProductTranslation(
      db,
      tenant.id,
      SEED_ACTOR,
      productPublicId,
      locale,
      { expectedTranslationVersion: translation.translationVersion },
    );
  }

  const menu = await createDraftMenu(db, tenant.id, admin, {
    internalName: "flowers-demo-shop",
    locationIds: [location.id],
    translations: {
      en: { displayName: "Flower Shop" },
      ar: { displayName: "متجر الزهور" },
    },
    sections: [
      {
        internalName: "bouquets",
        sortOrder: 0,
        translations: {
          en: { displayName: "Bouquets" },
          ar: { displayName: "باقات" },
        },
        products: [{ productPublicId, sortOrder: 0 }],
      },
    ],
  });

  await publishDraftMenuToLocations(db, tenant.id, SEED_ACTOR, menu.publicId, {
    locationIds: [location.id],
  });

  await assignPublishedCollection(
    db,
    tenant.id,
    storefront.publicId,
    location.publicId,
    menu.publicId,
  );

  const release = await publishStorefrontRelease(
    db,
    tenant.id,
    storefront.publicId,
    SEED_ACTOR,
  );

  await db
    .insert(storefrontLocations)
    .values({
      tenantId: tenant.id,
      storefrontId: storefront.id,
      locationId: location.id,
    })
    .onConflictDoNothing();

  console.log(
    JSON.stringify(
      {
        tenantPublicId: tenant.publicId,
        storefrontPublicId: storefront.publicId,
        locationPublicId: location.publicId,
        hostname: FLOWERS_HOSTNAME,
        productPublicId,
        menuPublicId: menu.publicId,
        releaseVersion: release.releaseVersion,
        themePreset: "generic_retail_baseline",
      },
      null,
      2,
    ),
  );

  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
