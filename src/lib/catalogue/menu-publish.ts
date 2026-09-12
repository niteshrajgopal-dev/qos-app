import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueMenuLiveRevisions,
  catalogueMenuLocations,
  catalogueMenuPublishOperations,
  catalogueMenus,
  catalogueProductTranslations,
  catalogueProducts,
  catalogueVariantLocationPriceOverrides,
  catalogueVariantPrices,
  catalogueVariants,
  locations,
  type MenuLiveSnapshotPayload,
  type PublicMenuProductSnapshot,
} from "@/db/schema";
import { resolveLocationVariantPrice } from "@/lib/catalogue/location-price-resolver";
import {
  type DraftMenuEditorView,
  loadDraftMenuEditorView,
  MenuError,
} from "@/lib/catalogue/menus";
import { ensureMenuPublicLink } from "@/lib/catalogue/public-menu-resolver";
import { validateProductTranslationsForPublish } from "@/lib/catalogue/translation-approval";
import { getApprovedThumbnailPublicIdForProduct } from "@/lib/media/product-images";
import {
  requireAdministratorMembership,
  StaffAuthorizationError,
} from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export type MenuPublishLocationResult = {
  locationId: string;
  locationPublicId: string;
  success: boolean;
  publicKey?: string;
  error?: string;
  field?: string;
};

export type MenuPublishResult = {
  menuPublicId: string;
  sourceVersion: number;
  operationId: string;
  status: "completed" | "partial" | "failed";
  results: MenuPublishLocationResult[];
};

export type MenuPublishPreviewTarget = {
  locationId: string;
  locationPublicId: string;
  locationName: string;
  currentSourceVersion: number | null;
  willChange: boolean;
  products: Array<{
    productPublicId: string;
    displayName: string;
    price: {
      amountMinor: number;
      currency: string;
      inheritanceMode: "inherited" | "override";
    };
  }>;
};

export type MenuPublishPreview = {
  menuPublicId: string;
  draftVersion: number;
  targets: MenuPublishPreviewTarget[];
};

export type PublishDraftMenuInput = {
  locationIds: string[];
  operationId?: string;
};

function sortedLocationIds(locationIds: string[]) {
  return [...locationIds].sort();
}

function sameLocationTargets(left: string[], right: string[]) {
  const a = sortedLocationIds(left);
  const b = sortedLocationIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function mapPublishError(error: unknown): never {
  if (
    error instanceof StaffAuthorizationError ||
    error instanceof MenuError
  ) {
    throw error;
  }

  throw error;
}

type ProductSnapshotContext = {
  productPublicId: string;
  translations: Record<
    "en" | "ar",
    { displayName: string; description: string | null }
  >;
  price: {
    amountMinor: number;
    currency: string;
    inheritanceMode: "inherited" | "override";
  };
  mediaAssetId: string | null;
};

async function loadApprovedProductSnapshots(
  tx: DbClient,
  tenantId: string,
  locationId: string,
  productPublicIds: string[],
): Promise<Map<string, ProductSnapshotContext>> {
  if (productPublicIds.length === 0) {
    return new Map();
  }

  const uniquePublicIds = [...new Set(productPublicIds)];

  const productRows = await tx
    .select({
      id: catalogueProducts.id,
      publicId: catalogueProducts.publicId,
    })
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        inArray(catalogueProducts.publicId, uniquePublicIds),
      ),
    );

  const productIdByPublicId = new Map(
    productRows.map((row) => [row.publicId, row.id]),
  );
  const productIds = productRows.map((row) => row.id);

  const translationRows =
    productIds.length === 0
      ? []
      : await tx
          .select()
          .from(catalogueProductTranslations)
          .where(
            and(
              eq(catalogueProductTranslations.tenantId, tenantId),
              inArray(catalogueProductTranslations.productId, productIds),
            ),
          );

  const variantRows =
    productIds.length === 0
      ? []
      : await tx
          .select({
            productId: catalogueVariants.productId,
            variantId: catalogueVariants.id,
          })
          .from(catalogueVariants)
          .where(
            and(
              eq(catalogueVariants.tenantId, tenantId),
              inArray(catalogueVariants.productId, productIds),
              eq(catalogueVariants.isDefault, true),
            ),
          );

  const variantIds = variantRows.map((row) => row.variantId);
  const variantIdByProductId = new Map(
    variantRows.map((row) => [row.productId, row.variantId]),
  );

  const centralPrices =
    variantIds.length === 0
      ? []
      : await tx
          .select()
          .from(catalogueVariantPrices)
          .where(
            and(
              eq(catalogueVariantPrices.tenantId, tenantId),
              inArray(catalogueVariantPrices.variantId, variantIds),
            ),
          );

  const centralPriceByVariantId = new Map(
    centralPrices.map((row) => [row.variantId, row]),
  );

  const overrideRows =
    variantIds.length === 0
      ? []
      : await tx
          .select()
          .from(catalogueVariantLocationPriceOverrides)
          .where(
            and(
              eq(catalogueVariantLocationPriceOverrides.tenantId, tenantId),
              eq(catalogueVariantLocationPriceOverrides.locationId, locationId),
              inArray(
                catalogueVariantLocationPriceOverrides.variantId,
                variantIds,
              ),
            ),
          );

  const overrideByVariantId = new Map(
    overrideRows.map((row) => [row.variantId, row]),
  );

  const snapshots = new Map<string, ProductSnapshotContext>();

  for (const publicId of uniquePublicIds) {
    const productId = productIdByPublicId.get(publicId);
    if (!productId) {
      continue;
    }

    const translations: ProductSnapshotContext["translations"] = {
      en: { displayName: "", description: null },
      ar: { displayName: "", description: null },
    };

    for (const row of translationRows.filter(
      (translation) => translation.productId === productId,
    )) {
      const locale = row.locale as "en" | "ar";
      if (locale !== "en" && locale !== "ar") {
        continue;
      }

      translations[locale] = {
        displayName: row.displayName,
        description: row.description,
      };
    }

    const variantId = variantIdByProductId.get(productId);
    const centralPrice = variantId
      ? centralPriceByVariantId.get(variantId)
      : undefined;

    if (!centralPrice) {
      throw new MenuError(
        `Default variant price is missing for product ${publicId}.`,
        400,
        `products.${publicId}.price`,
      );
    }

    const override = variantId ? overrideByVariantId.get(variantId) : undefined;
    const resolved = resolveLocationVariantPrice(
      {
        amountMinor: centralPrice.amountMinor,
        currency: centralPrice.currency.trim(),
        version: centralPrice.version,
      },
      override
        ? {
            amountMinor: override.amountMinor,
            currency: override.currency.trim(),
          }
        : null,
    );

    const mediaAssetId = await getApprovedThumbnailPublicIdForProduct(
      tx,
      tenantId,
      productId,
    );

    snapshots.set(publicId, {
      productPublicId: publicId,
      translations,
      price: {
        amountMinor: resolved.amountMinor,
        currency: resolved.currency,
        inheritanceMode: resolved.inheritanceMode,
      },
      mediaAssetId,
    });
  }

  return snapshots;
}

function compileLocationSnapshot(
  view: DraftMenuEditorView,
  locationPublicId: string,
  productSnapshots: Map<string, ProductSnapshotContext>,
): MenuLiveSnapshotPayload {
  return {
    menuPublicId: view.publicId,
    locationPublicId,
    version: view.version,
    translations: {
      en: {
        displayName: view.translations.en.displayName,
        description: view.translations.en.description,
      },
      ar: {
        displayName: view.translations.ar.displayName,
        description: view.translations.ar.description,
      },
    },
    sections: view.sections
      .filter((section) => !section.archived)
      .map((section) => ({
        publicId: section.publicId,
        sortOrder: section.sortOrder,
        translations: {
          en: {
            displayName: section.translations.en.displayName,
            description: section.translations.en.description,
          },
          ar: {
            displayName: section.translations.ar.displayName,
            description: section.translations.ar.description,
          },
        },
        products: section.products
          .filter((product) => !product.archived)
          .map((product) => {
            const snapshot = productSnapshots.get(product.productPublicId);
            if (!snapshot) {
              throw new MenuError(
                `Menu references unknown product ${product.productPublicId}.`,
                400,
                `products.${product.productPublicId}`,
              );
            }

            const publicProduct: PublicMenuProductSnapshot = {
              productPublicId: product.productPublicId,
              sortOrder: product.sortOrder,
              translations: snapshot.translations,
              price: snapshot.price,
              mediaAssetId: snapshot.mediaAssetId,
            };

            return publicProduct;
          }),
      })),
  };
}

async function resolveMenuTargetLocations(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  locationIds: string[],
) {
  if (locationIds.length === 0) {
    throw new MenuError(
      "At least one publish target location must be selected explicitly.",
      400,
      "locationIds",
    );
  }

  const uniqueLocationIds = [...new Set(locationIds)];

  const menuLocations = await tx
    .select({ locationId: catalogueMenuLocations.locationId })
    .from(catalogueMenuLocations)
    .where(
      and(
        eq(catalogueMenuLocations.tenantId, tenantId),
        eq(catalogueMenuLocations.menuId, menuId),
      ),
    );

  const allowedLocationIds = new Set(
    menuLocations.map((row) => row.locationId),
  );

  for (const locationId of uniqueLocationIds) {
    if (!allowedLocationIds.has(locationId)) {
      throw new MenuError(
        "Publish target location is not assigned to this menu.",
        400,
        "locationIds",
      );
    }
  }

  const locationRows = await tx
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        inArray(locations.id, uniqueLocationIds),
      ),
    );

  if (locationRows.length !== uniqueLocationIds.length) {
    throw new MenuError(
      "One or more publish target locations are invalid for this tenant.",
      404,
      "locationIds",
    );
  }

  return locationRows;
}

async function buildPreviewTargets(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  view: DraftMenuEditorView,
  locationIds: string[],
) {
  const targets = await resolveMenuTargetLocations(
    tx,
    tenantId,
    menuId,
    locationIds,
  );

  const productPublicIds = view.sections.flatMap((section) =>
    section.products
      .filter((product) => !product.archived)
      .map((product) => product.productPublicId),
  );

  const existingRevisions = await tx
    .select({
      locationId: catalogueMenuLiveRevisions.locationId,
      sourceVersion: catalogueMenuLiveRevisions.sourceVersion,
    })
    .from(catalogueMenuLiveRevisions)
    .where(
      and(
        eq(catalogueMenuLiveRevisions.tenantId, tenantId),
        eq(catalogueMenuLiveRevisions.menuId, menuId),
      ),
    );

  const revisionByLocationId = new Map(
    existingRevisions.map((row) => [row.locationId, row.sourceVersion]),
  );

  const previewTargets: MenuPublishPreviewTarget[] = [];

  for (const location of targets) {
    const snapshots = await loadApprovedProductSnapshots(
      tx,
      tenantId,
      location.id,
      productPublicIds,
    );

    previewTargets.push({
      locationId: location.id,
      locationPublicId: location.publicId,
      locationName: location.name,
      currentSourceVersion: revisionByLocationId.get(location.id) ?? null,
      willChange: revisionByLocationId.get(location.id) !== view.version,
      products: productPublicIds
        .map((productPublicId) => snapshots.get(productPublicId))
        .filter((snapshot): snapshot is ProductSnapshotContext =>
          Boolean(snapshot),
        )
        .map((snapshot) => ({
          productPublicId: snapshot.productPublicId,
          displayName: snapshot.translations.en.displayName,
          price: snapshot.price,
        })),
    });
  }

  return previewTargets;
}

export async function getMenuPublishPreview(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  menuPublicId: string,
  locationIds: string[],
): Promise<MenuPublishPreview> {
  try {
    await requireAdministratorMembership(db, tenantId, adminSubject);

    return await withTenantContext(db, tenantId, async (tx) => {
      const view = await loadDraftMenuEditorView(tx, tenantId, menuPublicId);
      if (!view) {
        throw new MenuError("Menu not found.", 404);
      }

      const [menu] = await tx
        .select({ id: catalogueMenus.id })
        .from(catalogueMenus)
        .where(
          and(
            eq(catalogueMenus.tenantId, tenantId),
            eq(catalogueMenus.publicId, menuPublicId),
          ),
        )
        .limit(1);

      if (!menu) {
        throw new MenuError("Menu not found.", 404);
      }

      const translationIssues = await validateProductTranslationsForPublish(
        tx,
        tenantId,
        view.sections.flatMap((section) =>
          section.products.map((product) => product.productPublicId),
        ),
      );

      if (translationIssues.length > 0) {
        const firstIssue = translationIssues[0]!;
        throw new MenuError(firstIssue.message, 400, firstIssue.field);
      }

      return {
        menuPublicId,
        draftVersion: view.version,
        targets: await buildPreviewTargets(
          tx,
          tenantId,
          menu.id,
          view,
          locationIds,
        ),
      };
    });
  } catch (error) {
    return mapPublishError(error);
  }
}

export async function publishDraftMenuToLocations(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  menuPublicId: string,
  input: PublishDraftMenuInput,
): Promise<MenuPublishResult> {
  try {
    await requireAdministratorMembership(db, tenantId, adminSubject);

    const operationId = input.operationId?.trim() || randomUUID();
    const targetLocationIds = sortedLocationIds(input.locationIds);

    return await withTenantContext(db, tenantId, async (tx) => {
      const view = await loadDraftMenuEditorView(tx, tenantId, menuPublicId);
      if (!view) {
        throw new MenuError("Menu not found.", 404);
      }

      const [menu] = await tx
        .select()
        .from(catalogueMenus)
        .where(
          and(
            eq(catalogueMenus.tenantId, tenantId),
            eq(catalogueMenus.publicId, menuPublicId),
          ),
        )
        .limit(1);

      if (!menu) {
        throw new MenuError("Menu not found.", 404);
      }

      const [existingOperation] = await tx
        .select()
        .from(catalogueMenuPublishOperations)
        .where(
          and(
            eq(catalogueMenuPublishOperations.tenantId, tenantId),
            eq(catalogueMenuPublishOperations.operationPublicId, operationId),
          ),
        )
        .limit(1);

      if (existingOperation) {
        if (existingOperation.menuId !== menu.id) {
          throw new MenuError(
            "Publish operation id is already used for a different menu.",
            409,
            "operationId",
          );
        }

        if (existingOperation.sourceVersion !== view.version) {
          throw new MenuError(
            "Publish operation id was already used for a different draft version.",
            409,
            "operationId",
          );
        }

        if (
          !sameLocationTargets(
            existingOperation.targetLocationIds,
            targetLocationIds,
          )
        ) {
          throw new MenuError(
            "Publish operation id cannot broaden or change target locations on retry.",
            409,
            "operationId",
          );
        }

        return {
          menuPublicId,
          sourceVersion: existingOperation.sourceVersion,
          operationId,
          status: existingOperation.status,
          results: existingOperation.locationResults,
        };
      }

      const productPublicIds = view.sections.flatMap((section) =>
        section.products
          .filter((product) => !product.archived)
          .map((product) => product.productPublicId),
      );

      const translationIssues = await validateProductTranslationsForPublish(
        tx,
        tenantId,
        productPublicIds,
      );

      if (translationIssues.length > 0) {
        const firstIssue = translationIssues[0]!;
        throw new MenuError(firstIssue.message, 400, firstIssue.field);
      }

      const targetLocations = await resolveMenuTargetLocations(
        tx,
        tenantId,
        menu.id,
        targetLocationIds,
      );

      const results: MenuPublishLocationResult[] = [];

      for (const location of targetLocations) {
        try {
          const snapshots = await loadApprovedProductSnapshots(
            tx,
            tenantId,
            location.id,
            productPublicIds,
          );
          const payload = compileLocationSnapshot(
            view,
            location.publicId,
            snapshots,
          );

          const [existingRevision] = await tx
            .select()
            .from(catalogueMenuLiveRevisions)
            .where(
              and(
                eq(catalogueMenuLiveRevisions.tenantId, tenantId),
                eq(catalogueMenuLiveRevisions.menuId, menu.id),
                eq(catalogueMenuLiveRevisions.locationId, location.id),
              ),
            )
            .limit(1);

          if (existingRevision) {
            await tx
              .update(catalogueMenuLiveRevisions)
              .set({
                sourceVersion: view.version,
                payload,
                publishedBySubject: adminSubject,
                createdAt: new Date(),
              })
              .where(eq(catalogueMenuLiveRevisions.id, existingRevision.id));
          } else {
            await tx.insert(catalogueMenuLiveRevisions).values({
              tenantId,
              menuId: menu.id,
              locationId: location.id,
              sourceVersion: view.version,
              payload,
              publishedBySubject: adminSubject,
            });
          }

          const publicKey = await ensureMenuPublicLink(
            tx,
            tenantId,
            menu.id,
            menuPublicId,
            location.id,
            location.publicId,
          );

          results.push({
            locationId: location.id,
            locationPublicId: location.publicId,
            success: true,
            publicKey,
          });
        } catch (error) {
          results.push({
            locationId: location.id,
            locationPublicId: location.publicId,
            success: false,
            error:
              error instanceof MenuError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Unable to publish to this location.",
            field: error instanceof MenuError ? error.field : undefined,
          });
        }
      }

      const successCount = results.filter((result) => result.success).length;
      const status =
        successCount === 0
          ? "failed"
          : successCount === results.length
            ? "completed"
            : "partial";

      await tx.insert(catalogueMenuPublishOperations).values({
        tenantId,
        menuId: menu.id,
        operationPublicId: operationId,
        publisherSubject: adminSubject,
        sourceVersion: view.version,
        targetLocationIds,
        status,
        locationResults: results,
      });

      if (successCount > 0) {
        await tx
          .update(catalogueMenus)
          .set({
            publishedVersion: view.version,
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(catalogueMenus.id, menu.id));
      }

      return {
        menuPublicId,
        sourceVersion: view.version,
        operationId,
        status,
        results,
      };
    });
  } catch (error) {
    return mapPublishError(error);
  }
}

export async function getCustomerMenuPayload(
  db: DbClient,
  tenantId: string,
  menuPublicId: string,
  locationPublicId: string,
): Promise<MenuLiveSnapshotPayload | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [menu] = await tx
      .select({ id: catalogueMenus.id })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenantId),
          eq(catalogueMenus.publicId, menuPublicId),
        ),
      )
      .limit(1);

    if (!menu) {
      return null;
    }

    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, tenantId),
          eq(locations.publicId, locationPublicId),
        ),
      )
      .limit(1);

    if (!location) {
      return null;
    }

    const [revision] = await tx
      .select({ payload: catalogueMenuLiveRevisions.payload })
      .from(catalogueMenuLiveRevisions)
      .where(
        and(
          eq(catalogueMenuLiveRevisions.tenantId, tenantId),
          eq(catalogueMenuLiveRevisions.menuId, menu.id),
          eq(catalogueMenuLiveRevisions.locationId, location.id),
        ),
      )
      .limit(1);

    return revision?.payload ?? null;
  });
}
