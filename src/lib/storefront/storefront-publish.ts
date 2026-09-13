import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenuPublicLinks,
  catalogueMenuSectionProducts,
  catalogueMenuSections,
  catalogueMenus,
  catalogueProducts,
  locations,
  storefrontDomains,
  storefrontLocations,
  storefrontPublishedCollections,
  storefrontReleases,
  storefronts,
} from "@/db/schema";
import { validateProductTranslationsForPublish } from "@/lib/catalogue/translation-approval";
import {
  StorefrontContentBlockValidationError,
  validateStorefrontContentBlocksInput,
} from "@/lib/storefront/storefront-content-blocks-schema";
import {
  requireAdministratorMembership,
  requireActiveStaffMembership,
  StaffAuthorizationError,
} from "@/lib/staff/auth";
import { clearHostResolutionCache } from "@/lib/storefront/host-resolution";
import {
  listStorefrontReleases,
  publishStorefrontReleaseInTx,
  rollbackStorefrontRelease,
  StorefrontError,
} from "@/lib/storefront/storefronts";
import { withTenantContext } from "@/lib/tenant/context";

export class StorefrontPublishError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly issues: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    issues: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
    this.name = "StorefrontPublishError";
    this.statusCode = statusCode;
    this.field = field;
    this.issues = issues;
  }
}

export type StorefrontPublishResult = {
  storefrontPublicId: string;
  releasePublicId: string;
  releaseVersion: number;
  idempotentReplay: boolean;
};

export type StorefrontRollbackResult = {
  storefrontPublicId: string;
  releasePublicId: string;
  releaseVersion: number;
  idempotentReplay: boolean;
};

function mapPublishServiceError(error: unknown): never {
  if (
    error instanceof StaffAuthorizationError ||
    error instanceof StorefrontError ||
    error instanceof StorefrontPublishError
  ) {
    throw error;
  }

  throw error;
}

export async function validateStorefrontDraftForPublish(
  tx: DbClient,
  tenantId: string,
  storefrontId: string,
  supportedLocales: string[],
) {
  const issues: Array<{ field: string; message: string }> = [];

  const assignedLocations = await tx
    .select({
      locationPublicId: locations.publicId,
    })
    .from(storefrontLocations)
    .innerJoin(
      locations,
      and(
        eq(storefrontLocations.tenantId, locations.tenantId),
        eq(storefrontLocations.locationId, locations.id),
      ),
    )
    .where(
      and(
        eq(storefrontLocations.tenantId, tenantId),
        eq(storefrontLocations.storefrontId, storefrontId),
      ),
    );

  if (assignedLocations.length === 0) {
    issues.push({
      field: "locations",
      message: "At least one storefront location must be assigned before publish.",
    });
  }

  const collections = await tx
    .select({
      locationPublicId: locations.publicId,
      menuPublicId: catalogueMenus.publicId,
      menuId: catalogueMenus.id,
      locationId: locations.id,
    })
    .from(storefrontPublishedCollections)
    .innerJoin(
      locations,
      and(
        eq(storefrontPublishedCollections.tenantId, locations.tenantId),
        eq(storefrontPublishedCollections.locationId, locations.id),
      ),
    )
    .innerJoin(
      catalogueMenus,
      and(
        eq(storefrontPublishedCollections.tenantId, catalogueMenus.tenantId),
        eq(storefrontPublishedCollections.menuId, catalogueMenus.id),
      ),
    )
    .where(
      and(
        eq(storefrontPublishedCollections.tenantId, tenantId),
        eq(storefrontPublishedCollections.storefrontId, storefrontId),
      ),
    );

  for (const location of assignedLocations) {
    const collection = collections.find(
      (row) => row.locationPublicId === location.locationPublicId,
    );

    if (!collection) {
      issues.push({
        field: "publishedCollections",
        message: `Location ${location.locationPublicId} has no published menu assignment.`,
      });
      continue;
    }

    const [link] = await tx
      .select({ publicKey: catalogueMenuPublicLinks.publicKey })
      .from(catalogueMenuPublicLinks)
      .where(
        and(
          eq(catalogueMenuPublicLinks.tenantId, tenantId),
          eq(catalogueMenuPublicLinks.menuId, collection.menuId),
          eq(catalogueMenuPublicLinks.locationId, collection.locationId),
        ),
      )
      .limit(1);

    if (!link?.publicKey) {
      issues.push({
        field: "publishedCollections",
        message: `Location ${location.locationPublicId} requires a published menu before storefront publish.`,
      });
    }
  }

  const [storefront] = await tx
    .select({ draftConfig: storefronts.draftConfig })
    .from(storefronts)
    .where(and(eq(storefronts.tenantId, tenantId), eq(storefronts.id, storefrontId)))
    .limit(1);

  const themePreset = storefront?.draftConfig.theme?.preset;
  if (typeof themePreset !== "string" || themePreset.trim().length === 0) {
    issues.push({
      field: "draftConfig.theme.preset",
      message: "Storefront theme preset is required before publish.",
    });
  }

  try {
    validateStorefrontContentBlocksInput(
      storefront?.draftConfig.contentBlocks ?? [],
      { supportedLocales },
    );
  } catch (error) {
    if (error instanceof StorefrontContentBlockValidationError) {
      issues.push(...error.issues);
    } else {
      throw error;
    }
  }

  if (supportedLocales.includes("ar")) {
    const menuIds = [...new Set(collections.map((collection) => collection.menuId))];

    if (menuIds.length > 0) {
      const productPublicIds = await tx
        .select({ publicId: catalogueProducts.publicId })
        .from(catalogueMenuSectionProducts)
        .innerJoin(
          catalogueMenuSections,
          and(
            eq(catalogueMenuSectionProducts.tenantId, catalogueMenuSections.tenantId),
            eq(catalogueMenuSectionProducts.sectionId, catalogueMenuSections.id),
          ),
        )
        .innerJoin(
          catalogueMenus,
          and(
            eq(catalogueMenuSections.tenantId, catalogueMenus.tenantId),
            eq(catalogueMenuSections.menuId, catalogueMenus.id),
          ),
        )
        .innerJoin(
          catalogueProducts,
          and(
            eq(catalogueMenuSectionProducts.tenantId, catalogueProducts.tenantId),
            eq(catalogueMenuSectionProducts.productId, catalogueProducts.id),
          ),
        )
        .where(
          and(
            eq(catalogueMenuSectionProducts.tenantId, tenantId),
            inArray(catalogueMenus.id, menuIds),
          ),
        );

      const uniqueProductIds = [
        ...new Set(productPublicIds.map((row) => row.publicId)),
      ];

      if (uniqueProductIds.length > 0) {
        const translationIssues = await validateProductTranslationsForPublish(
          tx,
          tenantId,
          uniqueProductIds,
        );

        for (const issue of translationIssues) {
          issues.push({
            field: `translations.${issue.productPublicId}.${issue.field}`,
            message: issue.message,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new StorefrontPublishError(
      "Storefront draft is not ready to publish.",
      400,
      "draft",
      issues,
    );
  }
}

export async function publishStorefrontReleaseAsAdministrator(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
) {
  try {
    await requireAdministratorMembership(db, tenantId, subject);

    const result = await withTenantContext(db, tenantId, async (tx) => {
      const [storefront] = await tx
        .select()
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

      await validateStorefrontDraftForPublish(
        tx,
        tenantId,
        storefront.id,
        storefront.supportedLocales,
      );

      const release = await publishStorefrontReleaseInTx(
        tx,
        tenantId,
        storefrontPublicId,
        subject,
      );

      return {
        storefrontPublicId,
        releasePublicId: release.publicId,
        releaseVersion: release.releaseVersion,
        idempotentReplay: release.idempotentReplay,
      };
    });

    clearHostResolutionCache();
    return result;
  } catch (error) {
    mapPublishServiceError(error);
  }
}

export async function rollbackStorefrontReleaseAsAdministrator(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
  releasePublicId: string,
) {
  try {
    await requireAdministratorMembership(db, tenantId, subject);

    const result = await rollbackStorefrontRelease(
      db,
      tenantId,
      storefrontPublicId,
      releasePublicId,
      subject,
    );

    clearHostResolutionCache();
    return result;
  } catch (error) {
    mapPublishServiceError(error);
  }
}

export type StorefrontAdminSummary = {
  publicId: string;
  internalName: string;
  slug: string;
  status: "draft" | "active" | "archived";
  draftVersion: number;
  primaryHostname: string | null;
  activeRelease: {
    releasePublicId: string;
    releaseVersion: number;
    publishedAt: string;
    publishedBySubject: string;
  } | null;
};

export async function listStorefrontsForStaff(
  db: DbClient,
  tenantId: string,
  subject: string,
): Promise<StorefrontAdminSummary[]> {
  try {
    await requireActiveStaffMembership(db, tenantId, subject);

    return withTenantContext(db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          publicId: storefronts.publicId,
          internalName: storefronts.internalName,
          slug: storefronts.slug,
          status: storefronts.status,
          draftVersion: storefronts.version,
          primaryHostname: storefrontDomains.hostname,
          releasePublicId: storefrontReleases.publicId,
          releaseVersion: storefrontReleases.releaseVersion,
          publishedAt: storefrontReleases.createdAt,
          publishedBySubject: storefrontReleases.publishedBySubject,
        })
        .from(storefronts)
        .leftJoin(
          storefrontDomains,
          and(
            eq(storefrontDomains.tenantId, storefronts.tenantId),
            eq(storefrontDomains.storefrontId, storefronts.id),
            eq(storefrontDomains.isPrimary, true),
          ),
        )
        .leftJoin(
          storefrontReleases,
          and(
            eq(storefrontReleases.tenantId, storefronts.tenantId),
            eq(storefrontReleases.id, storefronts.activeReleaseId),
          ),
        )
        .where(eq(storefronts.tenantId, tenantId));

      return rows.map((row) => ({
        publicId: row.publicId,
        internalName: row.internalName,
        slug: row.slug,
        status: row.status,
        draftVersion: row.draftVersion,
        primaryHostname: row.primaryHostname ?? null,
        activeRelease:
          row.releasePublicId && row.releaseVersion != null && row.publishedAt
            ? {
                releasePublicId: row.releasePublicId,
                releaseVersion: row.releaseVersion,
                publishedAt: row.publishedAt.toISOString(),
                publishedBySubject: row.publishedBySubject ?? "unknown",
              }
            : null,
      }));
    });
  } catch (error) {
    mapPublishServiceError(error);
  }
}

export async function listStorefrontReleasesForStaff(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
) {
  try {
    await requireActiveStaffMembership(db, tenantId, subject);
    return listStorefrontReleases(db, tenantId, storefrontPublicId);
  } catch (error) {
    mapPublishServiceError(error);
  }
}

export async function getActiveStorefrontReleaseSummary(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        activeReleaseId: storefronts.activeReleaseId,
        version: storefronts.version,
        status: storefronts.status,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, storefrontPublicId),
        ),
      )
      .limit(1);

    if (!storefront?.activeReleaseId) {
      return null;
    }

    const [release] = await tx
      .select({
        publicId: storefrontReleases.publicId,
        releaseVersion: storefrontReleases.releaseVersion,
        createdAt: storefrontReleases.createdAt,
        publishedBySubject: storefrontReleases.publishedBySubject,
      })
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.tenantId, tenantId),
          eq(storefrontReleases.id, storefront.activeReleaseId),
        ),
      )
      .limit(1);

    return release ?? null;
  });
}

export async function listRecentStorefrontReleases(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  limit = 20,
) {
  const releases = await listStorefrontReleases(db, tenantId, storefrontPublicId);
  return releases
    .sort((left, right) => right.releaseVersion - left.releaseVersion)
    .slice(0, limit)
    .map((release) => ({
      releasePublicId: release.publicId,
      releaseVersion: release.releaseVersion,
      publishedBySubject: release.publishedBySubject,
      createdAt: release.createdAt.toISOString(),
    }));
}
