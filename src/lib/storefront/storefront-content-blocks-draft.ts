import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  catalogueMenus,
  catalogueProducts,
  storefrontReleases,
  storefronts,
} from "@/db/schema";
import { summarizeStorefrontContentBlocks } from "@/lib/audit/tenant-audit";
import {
  legacyHeroBlockToDraftBlocks,
  normalizePersistedContentBlocks,
  StorefrontContentBlockValidationError,
  storefrontContentBlocksToDraftConfig,
  validateStorefrontContentBlocksInput,
  type StorefrontContentBlockDraft,
} from "@/lib/storefront/storefront-content-blocks-schema";
import {
  StorefrontConflictError,
  StorefrontError,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
} from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export type StorefrontContentBlocksDraftView = {
  storefrontPublicId: string;
  draftVersion: number;
  supportedLocales: string[];
  contentBlocks: StorefrontContentBlockDraft[];
  activeReleaseContentBlocks: Array<Record<string, unknown>>;
};

export type SaveStorefrontContentBlocksDraftInput = {
  expectedVersion: number;
  contentBlocks: unknown;
};

async function assertOwnedMediaDerivatives(
  tx: DbClient,
  tenantId: string,
  publicDerivativeIds: string[],
) {
  if (publicDerivativeIds.length === 0) {
    return;
  }

  const rows = await tx
    .select({
      publicDerivativeId: catalogueMediaDerivatives.publicDerivativeId,
      status: catalogueMediaAssets.status,
    })
    .from(catalogueMediaDerivatives)
    .innerJoin(
      catalogueMediaAssets,
      and(
        eq(catalogueMediaDerivatives.tenantId, catalogueMediaAssets.tenantId),
        eq(catalogueMediaDerivatives.assetId, catalogueMediaAssets.id),
      ),
    )
    .where(
      and(
        eq(catalogueMediaDerivatives.tenantId, tenantId),
        inArray(
          catalogueMediaDerivatives.publicDerivativeId,
          publicDerivativeIds,
        ),
      ),
    );

  const approved = new Set(
    rows
      .filter((row) => row.status === "approved")
      .map((row) => row.publicDerivativeId),
  );

  for (const publicDerivativeId of publicDerivativeIds) {
    if (!approved.has(publicDerivativeId)) {
      throw new StorefrontContentBlockValidationError(
        "Media reference must be an approved tenant asset.",
        "contentBlocks",
        [
          {
            field: "contentBlocks",
            message: `Media derivative ${publicDerivativeId} is not approved for this tenant.`,
          },
        ],
      );
    }
  }
}

async function assertOwnedCatalogueReferences(
  tx: DbClient,
  tenantId: string,
  blocks: StorefrontContentBlockDraft[],
) {
  const productPublicIds = new Set<string>();
  const menuPublicIds = new Set<string>();
  const mediaDerivativeIds = new Set<string>();

  for (const block of blocks) {
    if (block.type === "featured_items" && Array.isArray(block.props.productPublicIds)) {
      for (const productPublicId of block.props.productPublicIds) {
        if (typeof productPublicId === "string") {
          productPublicIds.add(productPublicId);
        }
      }
    }

    if (
      block.type === "category_collection" &&
      typeof block.props.menuPublicId === "string"
    ) {
      menuPublicIds.add(block.props.menuPublicId);
    }

    for (const key of ["imagePublicDerivativeId"] as const) {
      const value = block.props[key];
      if (typeof value === "string" && value.length > 0) {
        mediaDerivativeIds.add(value);
      }
    }
  }

  if (productPublicIds.size > 0) {
    const rows = await tx
      .select({ publicId: catalogueProducts.publicId })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          inArray(catalogueProducts.publicId, [...productPublicIds]),
        ),
      );

    const owned = new Set(rows.map((row) => row.publicId));
    for (const productPublicId of productPublicIds) {
      if (!owned.has(productPublicId)) {
        throw new StorefrontContentBlockValidationError(
          "Featured product reference is not owned by this tenant.",
          "contentBlocks",
          [
            {
              field: "contentBlocks",
              message: `Product ${productPublicId} was not found for this tenant.`,
            },
          ],
        );
      }
    }
  }

  if (menuPublicIds.size > 0) {
    const rows = await tx
      .select({ publicId: catalogueMenus.publicId })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenantId),
          inArray(catalogueMenus.publicId, [...menuPublicIds]),
        ),
      );

    const owned = new Set(rows.map((row) => row.publicId));
    for (const menuPublicId of menuPublicIds) {
      if (!owned.has(menuPublicId)) {
        throw new StorefrontContentBlockValidationError(
          "Menu reference is not owned by this tenant.",
          "contentBlocks",
          [
            {
              field: "contentBlocks",
              message: `Menu ${menuPublicId} was not found for this tenant.`,
            },
          ],
        );
      }
    }
  }

  await assertOwnedMediaDerivatives(tx, tenantId, [...mediaDerivativeIds]);
}

function readPersistedContentBlocks(
  rawBlocks: Array<{
    id: string;
    type: string;
    props: Record<string, unknown>;
    schemaVersion?: number;
    visible?: boolean;
  }> | undefined,
  supportedLocales: string[],
): StorefrontContentBlockDraft[] {
  const normalized = normalizePersistedContentBlocks(rawBlocks, supportedLocales);
  if (normalized.length > 0) {
    return normalized;
  }

  if (!rawBlocks || rawBlocks.length === 0) {
    return [];
  }

  return legacyHeroBlockToDraftBlocks(rawBlocks, supportedLocales);
}

export async function getStorefrontContentBlocksDraftForStaff(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
): Promise<StorefrontContentBlocksDraftView> {
  await requireActiveStaffMembership(db, tenantId, subject);

  return withTenantContext(db, tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        publicId: storefronts.publicId,
        version: storefronts.version,
        supportedLocales: storefronts.supportedLocales,
        draftConfig: storefronts.draftConfig,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, storefrontPublicId),
        ),
      )
      .limit(1);

    if (!storefront) {
      throw new StorefrontError("Storefront not found.", 404);
    }

    let activeReleaseContentBlocks: Array<Record<string, unknown>> = [];
    if (storefront.activeReleaseId) {
      const [release] = await tx
        .select({ payload: storefrontReleases.payload })
        .from(storefrontReleases)
        .where(
          and(
            eq(storefrontReleases.tenantId, tenantId),
            eq(storefrontReleases.id, storefront.activeReleaseId),
          ),
        )
        .limit(1);

      activeReleaseContentBlocks = release?.payload.contentBlocks ?? [];
    }

    return {
      storefrontPublicId: storefront.publicId,
      draftVersion: storefront.version,
      supportedLocales: storefront.supportedLocales,
      contentBlocks: readPersistedContentBlocks(
        storefront.draftConfig.contentBlocks,
        storefront.supportedLocales,
      ),
      activeReleaseContentBlocks,
    };
  });
}

export async function saveStorefrontContentBlocksDraftAsAdministrator(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
  input: SaveStorefrontContentBlocksDraftInput,
) {
  await requireAdministratorMembership(db, tenantId, subject);

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new StorefrontError(
      "expectedVersion must be a positive integer.",
      400,
      "expectedVersion",
    );
  }

  const [current] = await withTenantContext(db, tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        version: storefronts.version,
        draftConfig: storefronts.draftConfig,
        supportedLocales: storefronts.supportedLocales,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, storefrontPublicId),
        ),
      )
      .limit(1);

    return [storefront];
  });

  if (!current) {
    throw new StorefrontError("Storefront not found.", 404);
  }

  const contentBlocks = validateStorefrontContentBlocksInput(input.contentBlocks, {
    supportedLocales: current.supportedLocales,
  });

  await withTenantContext(db, tenantId, async (tx) => {
    await assertOwnedCatalogueReferences(tx, tenantId, contentBlocks);
  });

  const updated = await updateStorefrontDraft(db, tenantId, storefrontPublicId, {
    expectedVersion: input.expectedVersion,
    draftConfig: {
      ...current.draftConfig,
      contentBlocks: storefrontContentBlocksToDraftConfig(contentBlocks),
    },
    audit: {
      actorSubject: subject,
      actorClass: "staff_administrator",
      action: "storefront.content_blocks_draft.save",
      beforeSummary: summarizeStorefrontContentBlocks(
        current.draftConfig.contentBlocks ?? null,
      ),
      afterSummary: summarizeStorefrontContentBlocks(
        storefrontContentBlocksToDraftConfig(contentBlocks),
      ),
    },
  });

  return {
    storefrontPublicId,
    draftVersion: updated.version,
    contentBlocks,
    savedBySubject: subject,
  };
}

export { StorefrontContentBlockValidationError, StorefrontConflictError };
