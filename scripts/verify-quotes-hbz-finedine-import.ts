/**
 * QOS-89 — post-import verification for Quotes HBZ FineDine catalogue.
 *
 *   npm run verify:quotes-hbz-finedine
 *
 * Requires DATABASE_URL (never logged). Draft-only checks; does not publish.
 */

import { and, eq, ilike, inArray, sql } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import {
  catalogueImportSourceLinks,
  catalogueMenuLocations,
  catalogueMenuSections,
  catalogueMenus,
  catalogueProductTranslations,
  catalogueProducts,
  catalogueVariantPrices,
  catalogueVariants,
  locations,
  tenants,
} from "@/db/schema";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";

const PRICE_SPOT_CHECKS: Array<{
  label: string;
  displayNames: string[];
  expectedAmountMinor: number;
}> = [
  {
    label: "Flat White / Flatwhite",
    displayNames: ["Flat White", "Flatwhite"],
    expectedAmountMinor: 2700,
  },
  {
    label: "Heaven Pie",
    displayNames: ["Heaven Pie"],
    expectedAmountMinor: 3800,
  },
  {
    label: "Vegan Lentil Soup",
    displayNames: ["Vegan Lentil Soup"],
    expectedAmountMinor: 2200,
  },
];

const OTHER_QUOTES_LOCATIONS = ["loc_quotes_hct"] as const;
const FLOWER_TENANT_PUBLIC_ID = "ten_flowers_dev";

const failures: string[] = [];

function check(condition: boolean, message: string) {
  if (!condition) {
    failures.push(message);
  }
}

async function resolveTenantId(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  publicId: string,
) {
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.publicId, publicId))
    .limit(1);

  if (!tenant) {
    throw new Error(`Tenant ${publicId} was not found.`);
  }

  return tenant.id;
}

async function verifyProductPrices(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  quotesTenantId: string,
) {
  console.log("Price spot-checks:");

  for (const spot of PRICE_SPOT_CHECKS) {
    const [row] = await db
      .select({
        displayName: catalogueProductTranslations.displayName,
        amountMinor: catalogueVariantPrices.amountMinor,
      })
      .from(catalogueProductTranslations)
      .innerJoin(
        catalogueProducts,
        and(
          eq(catalogueProducts.tenantId, quotesTenantId),
          eq(catalogueProducts.id, catalogueProductTranslations.productId),
        ),
      )
      .innerJoin(
        catalogueVariants,
        and(
          eq(catalogueVariants.tenantId, quotesTenantId),
          eq(catalogueVariants.productId, catalogueProducts.id),
          eq(catalogueVariants.isDefault, true),
        ),
      )
      .innerJoin(
        catalogueVariantPrices,
        and(
          eq(catalogueVariantPrices.tenantId, quotesTenantId),
          eq(catalogueVariantPrices.variantId, catalogueVariants.id),
        ),
      )
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, quotesTenantId),
          inArray(
            catalogueProductTranslations.displayName,
            spot.displayNames,
          ),
        ),
      )
      .limit(1);

    const actual = row?.amountMinor ?? null;
    const display = row?.displayName ?? "(missing)";
    console.log(
      `  ${spot.label}: display_name=${display}, amount_minor=${actual ?? "null"}`,
    );
    check(
      actual === spot.expectedAmountMinor,
      `${spot.label}: expected amount_minor=${spot.expectedAmountMinor}, got ${actual ?? "null"}`,
    );
  }
}

async function verifyDraftMenu(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  quotesTenantId: string,
) {
  const [menu] = await db
    .select({
      id: catalogueMenus.id,
      publicId: catalogueMenus.publicId,
      internalName: catalogueMenus.internalName,
      status: catalogueMenus.status,
      version: catalogueMenus.version,
      publishedVersion: catalogueMenus.publishedVersion,
    })
    .from(catalogueMenus)
    .where(
      and(
        eq(catalogueMenus.tenantId, quotesTenantId),
        eq(
          catalogueMenus.internalName,
          QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName,
        ),
      ),
    )
    .limit(1);

  console.log("Draft menu:");
  if (!menu) {
    console.log("  (missing)");
    check(false, `Menu ${QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName} not found.`);
    return;
  }

  console.log(
    `  internal_name=${menu.internalName}, public_id=${menu.publicId}, status=${menu.status}, version=${menu.version}, published_version=${menu.publishedVersion ?? "null"}`,
  );
  check(menu.status === "draft", `Menu status expected draft, got ${menu.status}.`);
  check(
    menu.publishedVersion == null,
    `Menu should not be published (published_version=${menu.publishedVersion}).`,
  );

  const menuLocations = await db
    .select({
      locationPublicId: locations.publicId,
      locationSlug: locations.slug,
    })
    .from(catalogueMenuLocations)
    .innerJoin(
      locations,
      and(
        eq(locations.tenantId, quotesTenantId),
        eq(locations.id, catalogueMenuLocations.locationId),
      ),
    )
    .where(
      and(
        eq(catalogueMenuLocations.tenantId, quotesTenantId),
        eq(catalogueMenuLocations.menuId, menu.id),
      ),
    );

  const boundLocationIds = menuLocations.map((row) => row.locationPublicId);
  console.log(
    `  bound locations: ${boundLocationIds.length > 0 ? boundLocationIds.join(", ") : "(none)"}`,
  );
  check(
    boundLocationIds.length === 1 &&
      boundLocationIds[0] === QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
    `Menu must be bound only to ${QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId}, got [${boundLocationIds.join(", ")}].`,
  );

  const [sectionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogueMenuSections)
    .where(
      and(
        eq(catalogueMenuSections.tenantId, quotesTenantId),
        eq(catalogueMenuSections.menuId, menu.id),
        eq(catalogueMenuSections.archived, false),
      ),
    );

  console.log(`  active sections: ${sectionCount?.count ?? 0}`);
  check((sectionCount?.count ?? 0) > 0, "Menu should have at least one section.");
}

async function verifyFlowerUntouched(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const flowerTenantId = await resolveTenantId(db, FLOWER_TENANT_PUBLIC_ID);

  const [importLinkCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogueImportSourceLinks)
    .where(
      and(
        eq(catalogueImportSourceLinks.tenantId, flowerTenantId),
        eq(
          catalogueImportSourceLinks.connectionKey,
          QUOTES_HBZ_FINEDINE_IMPORT.connectionKey,
        ),
      ),
    );

  const [finedineSectionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogueMenuSections)
    .where(
      and(
        eq(catalogueMenuSections.tenantId, flowerTenantId),
        ilike(catalogueMenuSections.publicId, "sec_fd_%"),
      ),
    );

  console.log("Flower tenant isolation:");
  console.log(
    `  finedine import links (${QUOTES_HBZ_FINEDINE_IMPORT.connectionKey}): ${importLinkCount?.count ?? 0}`,
  );
  console.log(`  sec_fd_* menu sections: ${finedineSectionCount?.count ?? 0}`);

  check(
    (importLinkCount?.count ?? 0) === 0,
    "Flower tenant must not have HBZ FineDine import source links.",
  );
  check(
    (finedineSectionCount?.count ?? 0) === 0,
    "Flower tenant must not have FineDine menu sections (sec_fd_*).",
  );
}

async function verifyOtherQuotesLocationsClean(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  quotesTenantId: string,
) {
  console.log("Other Quotes locations (no HBZ FineDine pollution):");

  for (const locationPublicId of OTHER_QUOTES_LOCATIONS) {
    const [location] = await db
      .select({ id: locations.id, slug: locations.slug })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, quotesTenantId),
          eq(locations.publicId, locationPublicId),
        ),
      )
      .limit(1);

    if (!location) {
      console.log(`  ${locationPublicId}: (not seeded — skipped)`);
      continue;
    }

    const boundMenus = await db
      .select({
        internalName: catalogueMenus.internalName,
        publicId: catalogueMenus.publicId,
      })
      .from(catalogueMenuLocations)
      .innerJoin(
        catalogueMenus,
        and(
          eq(catalogueMenus.tenantId, quotesTenantId),
          eq(catalogueMenus.id, catalogueMenuLocations.menuId),
        ),
      )
      .where(
        and(
          eq(catalogueMenuLocations.tenantId, quotesTenantId),
          eq(catalogueMenuLocations.locationId, location.id),
        ),
      );

    const hbzMenuBound = boundMenus.some(
      (menu) =>
        menu.internalName === QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName,
    );

    const [finedineSectionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(catalogueMenuSections)
      .innerJoin(
        catalogueMenus,
        and(
          eq(catalogueMenus.tenantId, quotesTenantId),
          eq(catalogueMenus.id, catalogueMenuSections.menuId),
        ),
      )
      .innerJoin(
        catalogueMenuLocations,
        and(
          eq(catalogueMenuLocations.tenantId, quotesTenantId),
          eq(catalogueMenuLocations.menuId, catalogueMenus.id),
          eq(catalogueMenuLocations.locationId, location.id),
        ),
      )
      .where(
        and(
          eq(catalogueMenuSections.tenantId, quotesTenantId),
          ilike(catalogueMenuSections.publicId, "sec_fd_%"),
        ),
      );

    console.log(
      `  ${locationPublicId} (${location.slug}): hbz menu bound=${hbzMenuBound}, sec_fd_* sections=${finedineSectionCount?.count ?? 0}`,
    );

    check(
      !hbzMenuBound,
      `${locationPublicId} must not be bound to ${QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName}.`,
    );
    check(
      (finedineSectionCount?.count ?? 0) === 0,
      `${locationPublicId} must not have FineDine cafe sections (sec_fd_*).`,
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Export it before running verification.");
    process.exitCode = 1;
    return;
  }

  const { db, sql: sqlClient } = createDbClient();

  try {
    const quotesTenantId = await resolveTenantId(
      db,
      QUOTES_HBZ_FINEDINE_IMPORT.tenantPublicId,
    );

    await verifyProductPrices(db, quotesTenantId);
    await verifyDraftMenu(db, quotesTenantId);
    await verifyFlowerUntouched(db);
    await verifyOtherQuotesLocationsClean(db, quotesTenantId);

    if (failures.length > 0) {
      console.error("\nVerification FAILED:");
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("\nVerification PASSED.");
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
