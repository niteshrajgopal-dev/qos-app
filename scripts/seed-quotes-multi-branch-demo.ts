import { and, eq } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import {
  brands,
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontLocations,
  storefronts,
} from "@/db/schema";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftProduct } from "@/lib/catalogue/products";
import { quotesLocationFixtures } from "@/lib/seed/fixtures/quotes-locations";
import { ensureSeedLocation } from "@/lib/tenant/repository";
import {
  assignPublishedCollection,
  publishStorefrontRelease,
} from "@/lib/storefront/storefronts";

const DEFAULT_STOREFRONT_PUBLIC_ID = "stf_quotes_e748d7fc";
const SEED_ACTOR = "seed.quotes-multi-branch@qosapp.com";

async function ensureStaffAdmin(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  locationIds: string[],
) {
  const [existingIdentity] = await db
    .select()
    .from(staffIdentities)
    .where(eq(staffIdentities.providerSubject, SEED_ACTOR))
    .limit(1);

  const identity =
    existingIdentity ??
    (
      await db
        .insert(staffIdentities)
        .values({ providerSubject: SEED_ACTOR, email: SEED_ACTOR })
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

  for (const locationId of locationIds) {
    await db
      .insert(staffLocationScopes)
      .values({
        tenantId,
        staffMembershipId: membership.id,
        locationId,
      })
      .onConflictDoNothing();
  }

  return {
    membershipId: membership.id,
    role: "administrator" as const,
    staffIdentityId: identity.id,
  };
}

async function ensureBranchMenu(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  admin: { membershipId: string; role: "administrator"; staffIdentityId: string },
  location: { id: string; publicId: string; name: string; slug: string },
) {
  const product = await createDraftProduct(db, tenantId, admin, {
    internalName: `quotes-demo-${location.slug}`,
    translations: {
      en: {
        displayName: `${location.name} Demo Latte`,
        description: `Sandbox checkout item for ${location.name}`,
      },
      ar: {
        displayName: `لاتيه ${location.name}`,
        description: `عنصر دفع تجريبي`,
      },
    },
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  });

  for (const locale of ["en", "ar"] as const) {
    await approveProductTranslation(
      db,
      tenantId,
      SEED_ACTOR,
      product.publicId,
      locale,
      {
        expectedTranslationVersion: product.translations[locale].translationVersion,
      },
    );
  }

  const menu = await createDraftMenu(db, tenantId, admin, {
    internalName: `quotes-demo-menu-${location.slug}`,
    locationIds: [location.id],
    translations: {
      en: { displayName: `${location.name} Menu` },
      ar: { displayName: `قائمة ${location.name}` },
    },
    sections: [
      {
        internalName: "drinks",
        sortOrder: 0,
        translations: {
          en: { displayName: "Drinks" },
          ar: { displayName: "مشروبات" },
        },
        products: [{ productPublicId: product.publicId, sortOrder: 0 }],
      },
    ],
  });

  await publishDraftMenuToLocations(db, tenantId, SEED_ACTOR, menu.publicId, {
    locationIds: [location.id],
  });

  return { productPublicId: product.publicId, menuPublicId: menu.publicId };
}

async function main() {
  const storefrontPublicId =
    process.argv[2]?.trim() ||
    process.env.QOS_STOREFRONT_PUBLIC_ID?.trim() ||
    DEFAULT_STOREFRONT_PUBLIC_ID;

  const { db, sql } = createDbClient();

  const [storefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.publicId, storefrontPublicId))
    .limit(1);

  if (!storefront) {
    throw new Error(`Storefront not found: ${storefrontPublicId}`);
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(eq(brands.id, storefront.brandId))
    .limit(1);

  if (!brand) {
    throw new Error("Brand not found for storefront.");
  }

  const branchRows = [];

  for (const fixture of quotesLocationFixtures) {
    const [existing] = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, storefront.tenantId),
          eq(locations.name, fixture.name),
        ),
      )
      .limit(1);

    const location =
      existing ??
      (await ensureSeedLocation(db, {
        tenantId: storefront.tenantId,
        brandId: brand.id,
        publicId: `${fixture.publicId}_${storefront.tenantId.slice(0, 8)}`,
        name: fixture.name,
        slug: fixture.slug,
        timezone: fixture.timezone,
      }));

    branchRows.push(location);
  }

  const admin = await ensureStaffAdmin(
    db,
    storefront.tenantId,
    branchRows.map((row) => row.id),
  );

  const branchResults = [];

  for (const location of branchRows.sort((a, b) => a.name.localeCompare(b.name))) {
    const menuResult = await ensureBranchMenu(db, storefront.tenantId, admin, location);

    await assignPublishedCollection(
      db,
      storefront.tenantId,
      storefront.publicId,
      location.publicId,
      menuResult.menuPublicId,
    );

    await db
      .insert(storefrontLocations)
      .values({
        tenantId: storefront.tenantId,
        storefrontId: storefront.id,
        locationId: location.id,
      })
      .onConflictDoNothing();

    branchResults.push({
      locationPublicId: location.publicId,
      slug: location.slug,
      name: location.name,
      menuPublicId: menuResult.menuPublicId,
      productPublicId: menuResult.productPublicId,
    });
  }

  const release = await publishStorefrontRelease(
    db,
    storefront.tenantId,
    storefront.publicId,
    SEED_ACTOR,
  );

  console.log(
    JSON.stringify(
      {
        storefrontPublicId: storefront.publicId,
        releasePublicId: release.publicId,
        releaseVersion: release.releaseVersion,
        branches: branchResults,
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
