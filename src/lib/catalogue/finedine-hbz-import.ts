import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueImportSourceLinks,
  catalogueMenus,
  catalogueProducts,
  locations,
  staffIdentities,
  staffMemberships,
} from "@/db/schema";
import {
  applyCatalogueImport,
  previewCatalogueImport,
} from "@/lib/catalogue/catalogue-import";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";
import {
  buildFineDineCatalogueImportCsv,
  fetchFineDinePublicMenuFlatList,
  loadFineDineFlatListFixture,
  parseFineDineFlatList,
  type ParsedFineDineMenu,
} from "@/lib/catalogue/finedine-menu-extract";
import {
  createDraftMenu,
  getDraftMenu,
  updateDraftMenu,
} from "@/lib/catalogue/menus";
import type { MenuSectionInput } from "@/lib/catalogue/menus.validation";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export type ImportQuotesHbzFineDineMenuInput = {
  tenantId?: string;
  staffSubject?: string;
  useLiveSource?: boolean;
  forceImageReingest?: boolean;
  idempotencyKey?: string;
};

export function parseQuotesHbzImportCliArgs(argv: string[]) {
  const readFlag = (name: string) =>
    argv
      .find((arg) => arg.startsWith(`${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");

  return {
    help: argv.includes("--help") || argv.includes("-h"),
    useLiveSource: argv.includes("--live"),
    forceImageReingest: argv.includes("--force-image-reingest"),
    idempotencyKey: readFlag("--idempotency-key"),
    tenantId: readFlag("--tenant-id"),
    staffSubject: readFlag("--staff-subject"),
  };
}

export function formatQuotesHbzImportCliHelp() {
  return [
    "Usage: npm run import:quotes-hbz-finedine -- [options]",
    "",
    "  --live                     Fetch the live FineDine menu instead of the fixture",
    "  --force-image-reingest     Re-ingest FineDine image_url even when primaryMediaAssetId is set.",
    "                             Skips items with an empty image_url. Use a fresh --idempotency-key",
    "                             so apply is not replayed.",
    "  --idempotency-key=KEY      Fresh apply key (required to re-apply after a completed import)",
    "  --tenant-id=UUID           Target tenant",
    "  --staff-subject=SUBJECT    Staff identity subject",
    "  --help                     Show this help",
    "",
    "Azure Blob (Container Apps):",
    "  MEDIA_STORAGE=azure-blob",
    "  MEDIA_AZURE_BLOB_CONNECTION_STRING=...   # or MEDIA_AZURE_BLOB_ACCOUNT_URL for Entra",
    "  # containers default media-private / media-public",
  ].join("\n");
}

export type ImportQuotesHbzFineDineMenuResult = {
  parsed: ParsedFineDineMenu;
  importOperationPublicId: string;
  importReport: Awaited<ReturnType<typeof applyCatalogueImport>>["report"];
  menuPublicId: string;
  menuVersion: number;
  productCount: number;
  sectionCount: number;
  replayedImport: boolean;
  createdMenu: boolean;
};

export async function ensureImportStaffAdmin(
  db: DbClient,
  tenantId: string,
  staffSubject: string,
): Promise<ActiveStaffMembership> {
  const [existingIdentity] = await db
    .select()
    .from(staffIdentities)
    .where(eq(staffIdentities.providerSubject, staffSubject))
    .limit(1);

  const identity =
    existingIdentity ??
    (
      await db
        .insert(staffIdentities)
        .values({ providerSubject: staffSubject, email: staffSubject })
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

  return {
    membershipId: membership.id,
    role: "administrator",
    staffIdentityId: identity.id,
  };
}

async function resolveHbzLocationId(db: DbClient, tenantId: string) {
  const [location] = await db
    .select({ id: locations.id })
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

  return location.id;
}

async function loadParsedMenu(useLiveSource: boolean) {
  const raw = useLiveSource
    ? await fetchFineDinePublicMenuFlatList({
        slug: QUOTES_HBZ_FINEDINE_IMPORT.qrSlug,
        menuId: QUOTES_HBZ_FINEDINE_IMPORT.menuId,
      })
    : await loadFineDineFlatListFixture(
        QUOTES_HBZ_FINEDINE_IMPORT.flatListFixturePath,
      );

  return parseFineDineFlatList(raw, QUOTES_HBZ_FINEDINE_IMPORT.menuId);
}

async function loadProductPublicIdsBySourceId(
  db: DbClient,
  tenantId: string,
  sourceIds: string[],
) {
  if (sourceIds.length === 0) {
    return new Map<string, string>();
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const links = await tx
      .select({
        sourceId: catalogueImportSourceLinks.sourceId,
        productPublicId: catalogueProducts.publicId,
      })
      .from(catalogueImportSourceLinks)
      .innerJoin(
        catalogueProducts,
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.id, catalogueImportSourceLinks.productId),
        ),
      )
      .where(
        and(
          eq(catalogueImportSourceLinks.tenantId, tenantId),
          eq(
            catalogueImportSourceLinks.connectionKey,
            QUOTES_HBZ_FINEDINE_IMPORT.connectionKey,
          ),
        ),
      );

    return new Map(
      links
        .filter((link) => sourceIds.includes(link.sourceId))
        .map((link) => [link.sourceId, link.productPublicId]),
    );
  });
}

function buildMenuSections(
  parsed: ParsedFineDineMenu,
  productPublicIdBySourceId: Map<string, string>,
): MenuSectionInput[] {
  return parsed.sections.map((section, sectionIndex) => ({
    publicId: `sec_fd_${section.sourceId}`,
    internalName: section.internalName,
    sortOrder: sectionIndex,
    translations: {
      en: {
        displayName: section.displayNameEn,
        description: section.categoryPath || null,
      },
      ar: {
        displayName: section.displayNameAr,
        description: section.categoryPath || null,
      },
    },
    products: section.itemSourceIds.flatMap((sourceId, productIndex) => {
      const productPublicId = productPublicIdBySourceId.get(sourceId);
      if (!productPublicId) {
        return [];
      }

      return [
        {
          productPublicId,
          sortOrder: productIndex,
        },
      ];
    }),
  }));
}

async function findExistingDraftMenu(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [menu] = await tx
      .select({
        publicId: catalogueMenus.publicId,
        version: catalogueMenus.version,
      })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenantId),
          eq(
            catalogueMenus.internalName,
            QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName,
          ),
        ),
      )
      .limit(1);

    return menu ?? null;
  });
}

async function ensureDraftMenuForHbz(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  locationId: string,
  sections: MenuSectionInput[],
) {
  const existing = await findExistingDraftMenu(db, tenantId);

  if (!existing) {
    const created = await createDraftMenu(db, tenantId, membership, {
      internalName: QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName,
      brandPublicId: QUOTES_HBZ_FINEDINE_IMPORT.brandPublicId,
      locationIds: [locationId],
      translations: {
        en: {
          displayName: "HBZ Stadium Menu",
          description: "Imported from FineDine HBZ Stadium branch menu.",
        },
        ar: {
          displayName: "HBZ Stadium Menu",
          description: "Imported from FineDine HBZ Stadium branch menu.",
        },
      },
      sections,
    });

    return {
      menuPublicId: created.publicId,
      menuVersion: created.version,
      createdMenu: true,
    };
  }

  const current = await getDraftMenu(db, tenantId, existing.publicId);
  const updated = await updateDraftMenu(
    db,
    tenantId,
    membership,
    existing.publicId,
    {
      expectedVersion: current.version,
      locationIds: [locationId],
      sections,
    },
  );

  return {
    menuPublicId: updated.publicId,
    menuVersion: updated.version,
    createdMenu: false,
  };
}

export async function importQuotesHbzFineDineMenu(
  db: DbClient,
  input: ImportQuotesHbzFineDineMenuInput = {},
): Promise<ImportQuotesHbzFineDineMenuResult> {
  const staffSubject =
    input.staffSubject ?? "import.quotes-hbz-finedine@qosapp.com";
  const idempotencyKey =
    input.idempotencyKey ?? `finedine-hbz-${QUOTES_HBZ_FINEDINE_IMPORT.menuId}`;

  const seeded = input.tenantId
    ? { tenantId: input.tenantId }
    : await seedQuotesDevTenant(db);
  const tenantId = seeded.tenantId;
  const membership = await ensureImportStaffAdmin(db, tenantId, staffSubject);
  const parsed = await loadParsedMenu(Boolean(input.useLiveSource));
  const csv = buildFineDineCatalogueImportCsv(parsed);

  const preview = await previewCatalogueImport(
    db,
    tenantId,
    membership,
    staffSubject,
    {
      fileName: "quotes-hbz-finedine.csv",
      bytes: Buffer.from(csv, "utf8"),
      connectionKey: QUOTES_HBZ_FINEDINE_IMPORT.connectionKey,
      idempotencyKey,
      forceImageReingest: Boolean(input.forceImageReingest),
    },
  );

  const applied = await applyCatalogueImport(
    db,
    tenantId,
    membership,
    staffSubject,
    {
      operationPublicId: preview.operationPublicId,
      previewHash: preview.previewHash,
      idempotencyKey,
      forceImageReingest: Boolean(input.forceImageReingest),
    },
  );

  const productPublicIdBySourceId = await loadProductPublicIdsBySourceId(
    db,
    tenantId,
    parsed.items.map((item) => item.sourceId),
  );

  if (productPublicIdBySourceId.size !== parsed.items.length) {
    throw new Error(
      `Expected ${parsed.items.length} imported product links, found ${productPublicIdBySourceId.size}.`,
    );
  }

  const locationId = await resolveHbzLocationId(db, tenantId);
  const sections = buildMenuSections(parsed, productPublicIdBySourceId);
  const menu = await ensureDraftMenuForHbz(
    db,
    tenantId,
    membership,
    locationId,
    sections,
  );

  return {
    parsed,
    importOperationPublicId: preview.operationPublicId,
    importReport: applied.report,
    menuPublicId: menu.menuPublicId,
    menuVersion: menu.menuVersion,
    productCount: parsed.items.length,
    sectionCount: sections.length,
    replayedImport: applied.replayed,
    createdMenu: menu.createdMenu,
  };
}

export async function buildQuotesHbzFineDineCatalogueImportCsv(
  useLiveSource = false,
) {
  const raw = useLiveSource
    ? await fetchFineDinePublicMenuFlatList({
        slug: QUOTES_HBZ_FINEDINE_IMPORT.qrSlug,
        menuId: QUOTES_HBZ_FINEDINE_IMPORT.menuId,
      })
    : await loadFineDineFlatListFixture(
        QUOTES_HBZ_FINEDINE_IMPORT.flatListFixturePath,
      );

  return buildFineDineCatalogueImportCsv(
    parseFineDineFlatList(raw, QUOTES_HBZ_FINEDINE_IMPORT.menuId),
  );
}
