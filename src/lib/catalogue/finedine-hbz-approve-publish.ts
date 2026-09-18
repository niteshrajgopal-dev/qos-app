import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { catalogueMenus, locations } from "@/db/schema";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";
import { ensureImportStaffAdmin } from "@/lib/catalogue/finedine-hbz-import";
import { getDraftMenu } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { getDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import {
  assignPublishedCollection,
  publishStorefrontRelease,
} from "@/lib/storefront/storefronts";
import type { ProductLocale } from "@/lib/catalogue/validation";

export const QUOTES_HBZ_FINEDINE_OPS_DEFAULT_STAFF_SUBJECT =
  "ops.quotes-hbz-finedine@qosapp.com";

export type ApprovePublishQuotesHbzFineDineMenuInput = {
  tenantId?: string;
  staffSubject?: string;
  menuPublicId?: string;
  menuInternalName?: string;
  /**
   * Optional override for tests only. Must resolve exclusively to HBZ Stadium.
   */
  locationIds?: string[];
};

export type ApprovePublishQuotesHbzFineDineMenuResult = {
  menuPublicId: string;
  productCount: number;
  translationApprovals: {
    approved: number;
    skipped: number;
  };
  publish: Awaited<ReturnType<typeof publishDraftMenuToLocations>>;
  storefront: {
    locationPublicId: string;
    menuPublicId: string;
    releasePublicId: string;
    releaseVersion: number;
  };
};

async function resolveHbzLocationId(db: DbClient, tenantId: string) {
  const [location] = await db
    .select({ id: locations.id, publicId: locations.publicId })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.publicId, QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new Error(
      `Location ${QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId} was not found for tenant ${tenantId}.`,
    );
  }

  return location;
}

async function resolveMenuPublicId(
  db: DbClient,
  tenantId: string,
  input: ApprovePublishQuotesHbzFineDineMenuInput,
) {
  if (input.menuPublicId?.trim()) {
    const [menu] = await db
      .select({ publicId: catalogueMenus.publicId })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenantId),
          eq(catalogueMenus.publicId, input.menuPublicId.trim()),
        ),
      )
      .limit(1);

    if (!menu) {
      throw new Error(
        `Draft menu ${input.menuPublicId.trim()} was not found for tenant ${tenantId}.`,
      );
    }

    return menu.publicId;
  }

  const internalName =
    input.menuInternalName?.trim() ??
    QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName;

  const [menu] = await db
    .select({ publicId: catalogueMenus.publicId })
    .from(catalogueMenus)
    .where(
      and(
        eq(catalogueMenus.tenantId, tenantId),
        eq(catalogueMenus.internalName, internalName),
      ),
    )
    .limit(1);

  if (!menu) {
    throw new Error(
      `Draft menu with internal name ${internalName} was not found for tenant ${tenantId}.`,
    );
  }

  return menu.publicId;
}

function collectMenuProductPublicIds(
  menu: Awaited<ReturnType<typeof getDraftMenu>>,
) {
  const productPublicIds = new Set<string>();

  for (const section of menu.sections) {
    for (const product of section.products) {
      if (!product.archived) {
        productPublicIds.add(product.productPublicId);
      }
    }
  }

  return [...productPublicIds].sort();
}

function assertHbzOnlyPublishTargets(
  requestedLocationIds: string[],
  hbzLocationId: string,
) {
  const uniqueRequested = [...new Set(requestedLocationIds)].sort();

  if (
    uniqueRequested.length !== 1 ||
    uniqueRequested[0] !== hbzLocationId
  ) {
    throw new Error(
      `Refusing to publish: only ${QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId} (${hbzLocationId}) is allowed.`,
    );
  }
}

async function approveLocaleIfNeeded(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  productPublicId: string,
  locale: ProductLocale,
  translation: {
    approvalStatus: "draft" | "approved";
    translationVersion: number;
  },
): Promise<"approved" | "skipped"> {
  if (translation.approvalStatus === "approved") {
    return "skipped";
  }

  await approveProductTranslation(
    db,
    tenantId,
    adminSubject,
    productPublicId,
    locale,
    { expectedTranslationVersion: translation.translationVersion },
  );

  return "approved";
}

export async function approveAndPublishQuotesHbzFineDineMenu(
  db: DbClient,
  input: ApprovePublishQuotesHbzFineDineMenuInput = {},
): Promise<ApprovePublishQuotesHbzFineDineMenuResult> {
  const staffSubject =
    input.staffSubject ?? QUOTES_HBZ_FINEDINE_OPS_DEFAULT_STAFF_SUBJECT;

  const seeded = input.tenantId
    ? { tenantId: input.tenantId }
    : await seedQuotesDevTenant(db);
  const tenantId = seeded.tenantId;

  const membership = await ensureImportStaffAdmin(db, tenantId, staffSubject);
  const hbzLocation = await resolveHbzLocationId(db, tenantId);
  const targetLocationIds = input.locationIds ?? [hbzLocation.id];

  assertHbzOnlyPublishTargets(targetLocationIds, hbzLocation.id);

  const menuPublicId = await resolveMenuPublicId(db, tenantId, input);
  const menu = await getDraftMenu(db, tenantId, menuPublicId);
  const productPublicIds = collectMenuProductPublicIds(menu);

  let approved = 0;
  let skipped = 0;

  for (const productPublicId of productPublicIds) {
    let product = await getDraftProduct(
      db,
      tenantId,
      membership,
      productPublicId,
    );

    for (const locale of ["en", "ar"] as const) {
      const outcome = await approveLocaleIfNeeded(
        db,
        tenantId,
        staffSubject,
        productPublicId,
        locale,
        product.translations[locale],
      );

      if (outcome === "approved") {
        approved += 1;
        product = await getDraftProduct(
          db,
          tenantId,
          membership,
          productPublicId,
        );
      } else {
        skipped += 1;
      }
    }
  }

  const publish = await publishDraftMenuToLocations(
    db,
    tenantId,
    staffSubject,
    menuPublicId,
    { locationIds: targetLocationIds },
  );

  await assignPublishedCollection(
    db,
    tenantId,
    QUOTES_HBZ_FINEDINE_IMPORT.storefrontPublicId,
    hbzLocation.publicId,
    menuPublicId,
  );

  const release = await publishStorefrontRelease(
    db,
    tenantId,
    QUOTES_HBZ_FINEDINE_IMPORT.storefrontPublicId,
    staffSubject,
  );

  return {
    menuPublicId,
    productCount: productPublicIds.length,
    translationApprovals: { approved, skipped },
    publish,
    storefront: {
      locationPublicId: hbzLocation.publicId,
      menuPublicId,
      releasePublicId: release.publicId,
      releaseVersion: release.releaseVersion,
    },
  };
}
