import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  brands,
  catalogueMenuLiveRevisions,
  catalogueMenuLocations,
  catalogueMenuSectionProducts,
  catalogueMenuSections,
  catalogueMenuSectionTranslations,
  catalogueMenuTranslations,
  catalogueMenus,
  catalogueProducts,
  catalogueProductTranslations,
  locations,
  staffLocationScopes,
} from "@/db/schema";
import {
  type CreateDraftMenuInput,
  type MenuSectionInput,
  type UpdateDraftMenuInput,
  MenuValidationError,
  validateCreateDraftMenuInput,
  validateUpdateDraftMenuInput,
} from "@/lib/catalogue/menus.validation";
import type { ProductLocale } from "@/lib/catalogue/validation";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class MenuError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "MenuError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class MenuConflictError extends MenuError {
  constructor(message: string, field?: string) {
    super(message, 409, field);
    this.name = "MenuConflictError";
  }
}

export type MenuTranslationView = {
  displayName: string;
  description: string | null;
  translationVersion: number;
};

export type MenuSectionProductView = {
  productPublicId: string;
  internalName: string;
  displayName: string;
  sortOrder: number;
  archived: boolean;
};

export type MenuSectionView = {
  publicId: string;
  internalName: string;
  sortOrder: number;
  archived: boolean;
  translations: Record<ProductLocale, MenuTranslationView>;
  products: MenuSectionProductView[];
};

export type DraftMenuSummaryView = {
  publicId: string;
  internalName: string;
  status: "draft" | "active" | "archived";
  version: number;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  isLive: boolean;
  sectionCount: number;
  itemCount: number;
  locationIds: string[];
  displayName: string;
  updatedAt: Date;
};

export type DraftMenuEditorView = DraftMenuSummaryView & {
  translations: Record<ProductLocale, MenuTranslationView>;
  sections: MenuSectionView[];
};

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "menu"
  );
}

function generateMenuPublicId(internalName: string) {
  return `men_${slugify(internalName)}_${randomUUID().slice(0, 8)}`;
}

function generateSectionPublicId(internalName: string) {
  return `sec_${slugify(internalName)}_${randomUUID().slice(0, 8)}`;
}

function mapMenuError(error: unknown): never {
  if (error instanceof MenuValidationError) {
    throw new MenuError(error.message, 400, error.field);
  }

  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof MenuError) {
    throw error;
  }

  throw error;
}

async function resolveBrandId(
  db: DbClient,
  tenantId: string,
  brandPublicId: string | null,
) {
  if (brandPublicId) {
    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(eq(brands.tenantId, tenantId), eq(brands.publicId, brandPublicId)),
      )
      .limit(1);

    if (!brand) {
      throw new MenuError("Brand not found for this tenant.", 404);
    }

    return brand.id;
  }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.tenantId, tenantId))
    .limit(1);

  if (!brand) {
    throw new MenuError("No brand is configured for this tenant.", 404);
  }

  return brand.id;
}

async function assertAuthorizedLocations(
  tx: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  locationIds: string[],
) {
  const rows = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        inArray(locations.id, locationIds),
      ),
    );

  if (rows.length !== locationIds.length) {
    throw new MenuError(
      "One or more locations are invalid for this tenant.",
      404,
      "locationIds",
    );
  }

  if (membership.role === "administrator") {
    return;
  }

  const scopedRows = await tx
    .select({ locationId: staffLocationScopes.locationId })
    .from(staffLocationScopes)
    .where(
      and(
        eq(staffLocationScopes.tenantId, tenantId),
        eq(staffLocationScopes.staffMembershipId, membership.membershipId),
        inArray(staffLocationScopes.locationId, locationIds),
      ),
    );

  if (scopedRows.length !== locationIds.length) {
    throw new StaffAuthorizationError(
      "Staff membership does not include all requested locations.",
    );
  }
}

async function resolveProductIdsByPublicId(
  tx: DbClient,
  tenantId: string,
  productPublicIds: string[],
) {
  if (productPublicIds.length === 0) {
    return new Map<string, string>();
  }

  const rows = await tx
    .select({
      id: catalogueProducts.id,
      publicId: catalogueProducts.publicId,
    })
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        inArray(catalogueProducts.publicId, productPublicIds),
      ),
    );

  const map = new Map(rows.map((row) => [row.publicId, row.id]));

  for (const publicId of productPublicIds) {
    if (!map.has(publicId)) {
      throw new MenuError(
        `Product ${publicId} was not found for this tenant.`,
        404,
        "sections.products.productPublicId",
      );
    }
  }

  return map;
}

async function replaceMenuLocations(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  locationIds: string[],
) {
  await tx
    .delete(catalogueMenuLocations)
    .where(
      and(
        eq(catalogueMenuLocations.tenantId, tenantId),
        eq(catalogueMenuLocations.menuId, menuId),
      ),
    );

  for (const locationId of locationIds) {
    await tx.insert(catalogueMenuLocations).values({
      tenantId,
      menuId,
      locationId,
    });
  }
}

async function upsertMenuTranslations(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  translations: Record<ProductLocale, { displayName: string; description: string | null }>,
) {
  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    const [existing] = await tx
      .select()
      .from(catalogueMenuTranslations)
      .where(
        and(
          eq(catalogueMenuTranslations.tenantId, tenantId),
          eq(catalogueMenuTranslations.menuId, menuId),
          eq(catalogueMenuTranslations.locale, locale),
        ),
      )
      .limit(1);

    if (!existing) {
      await tx.insert(catalogueMenuTranslations).values({
        tenantId,
        menuId,
        locale,
        displayName: translation.displayName,
        description: translation.description,
      });
      continue;
    }

    const changed =
      existing.displayName !== translation.displayName ||
      existing.description !== translation.description;

    if (changed) {
      await tx
        .update(catalogueMenuTranslations)
        .set({
          displayName: translation.displayName,
          description: translation.description,
          translationVersion: existing.translationVersion + 1,
          approvalStatus: "draft",
          updatedAt: new Date(),
        })
        .where(eq(catalogueMenuTranslations.id, existing.id));
    }
  }
}

async function upsertSectionTranslations(
  tx: DbClient,
  tenantId: string,
  sectionId: string,
  translations: Record<ProductLocale, { displayName: string; description: string | null }>,
) {
  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    const [existing] = await tx
      .select()
      .from(catalogueMenuSectionTranslations)
      .where(
        and(
          eq(catalogueMenuSectionTranslations.tenantId, tenantId),
          eq(catalogueMenuSectionTranslations.sectionId, sectionId),
          eq(catalogueMenuSectionTranslations.locale, locale),
        ),
      )
      .limit(1);

    if (!existing) {
      await tx.insert(catalogueMenuSectionTranslations).values({
        tenantId,
        sectionId,
        locale,
        displayName: translation.displayName,
        description: translation.description,
      });
      continue;
    }

    const changed =
      existing.displayName !== translation.displayName ||
      existing.description !== translation.description;

    if (changed) {
      await tx
        .update(catalogueMenuSectionTranslations)
        .set({
          displayName: translation.displayName,
          description: translation.description,
          translationVersion: existing.translationVersion + 1,
          approvalStatus: "draft",
          updatedAt: new Date(),
        })
        .where(eq(catalogueMenuSectionTranslations.id, existing.id));
    }
  }
}

async function syncMenuSections(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  sections: MenuSectionInput[],
) {
  const productPublicIds = sections.flatMap((section) =>
    section.products.map((product) => product.productPublicId.trim()),
  );
  const productIdByPublicId = await resolveProductIdsByPublicId(
    tx,
    tenantId,
    [...new Set(productPublicIds)],
  );

  const existingSections = await tx
    .select()
    .from(catalogueMenuSections)
    .where(
      and(
        eq(catalogueMenuSections.tenantId, tenantId),
        eq(catalogueMenuSections.menuId, menuId),
      ),
    );

  const incomingPublicIds = sections
    .map((section) => section.publicId?.trim())
    .filter((value): value is string => Boolean(value));

  const sectionsToRemove = existingSections.filter(
    (section) => !incomingPublicIds.includes(section.publicId),
  );

  for (const section of sectionsToRemove) {
    await tx
      .delete(catalogueMenuSectionProducts)
      .where(
        and(
          eq(catalogueMenuSectionProducts.tenantId, tenantId),
          eq(catalogueMenuSectionProducts.sectionId, section.id),
        ),
      );
    await tx
      .delete(catalogueMenuSectionTranslations)
      .where(
        and(
          eq(catalogueMenuSectionTranslations.tenantId, tenantId),
          eq(catalogueMenuSectionTranslations.sectionId, section.id),
        ),
      );
    await tx
      .delete(catalogueMenuSections)
      .where(eq(catalogueMenuSections.id, section.id));
  }

  for (const sectionInput of sections) {
    const sectionPublicId =
      sectionInput.publicId?.trim() || generateSectionPublicId(sectionInput.internalName);

    let section = existingSections.find(
      (row) => row.publicId === sectionPublicId,
    );

    if (!section) {
      [section] = await tx
        .insert(catalogueMenuSections)
        .values({
          tenantId,
          menuId,
          publicId: sectionPublicId,
          internalName: sectionInput.internalName.trim(),
          sortOrder: sectionInput.sortOrder,
          archived: sectionInput.archived ?? false,
        })
        .returning();
    } else {
      await tx
        .update(catalogueMenuSections)
        .set({
          internalName: sectionInput.internalName.trim(),
          sortOrder: sectionInput.sortOrder,
          archived: sectionInput.archived ?? false,
          updatedAt: new Date(),
        })
        .where(eq(catalogueMenuSections.id, section.id));
    }

    await upsertSectionTranslations(tx, tenantId, section.id, {
      en: {
        displayName: sectionInput.translations.en.displayName.trim(),
        description: sectionInput.translations.en.description?.trim() || null,
      },
      ar: {
        displayName: sectionInput.translations.ar.displayName.trim(),
        description: sectionInput.translations.ar.description?.trim() || null,
      },
    });

    const incomingProductIds = sectionInput.products.map((product) =>
      productIdByPublicId.get(product.productPublicId.trim())!,
    );

    if (incomingProductIds.length > 0) {
      await tx
        .delete(catalogueMenuSectionProducts)
        .where(
          and(
            eq(catalogueMenuSectionProducts.tenantId, tenantId),
            eq(catalogueMenuSectionProducts.sectionId, section.id),
            notInArray(catalogueMenuSectionProducts.productId, incomingProductIds),
          ),
        );
    } else {
      await tx
        .delete(catalogueMenuSectionProducts)
        .where(
          and(
            eq(catalogueMenuSectionProducts.tenantId, tenantId),
            eq(catalogueMenuSectionProducts.sectionId, section.id),
          ),
        );
    }

    for (const productInput of sectionInput.products) {
      const productId = productIdByPublicId.get(
        productInput.productPublicId.trim(),
      )!;

      const [existingPlacement] = await tx
        .select()
        .from(catalogueMenuSectionProducts)
        .where(
          and(
            eq(catalogueMenuSectionProducts.tenantId, tenantId),
            eq(catalogueMenuSectionProducts.sectionId, section.id),
            eq(catalogueMenuSectionProducts.productId, productId),
          ),
        )
        .limit(1);

      if (existingPlacement) {
        await tx
          .update(catalogueMenuSectionProducts)
          .set({
            sortOrder: productInput.sortOrder,
            archived: productInput.archived ?? false,
            updatedAt: new Date(),
          })
          .where(eq(catalogueMenuSectionProducts.id, existingPlacement.id));
      } else {
        await tx.insert(catalogueMenuSectionProducts).values({
          tenantId,
          sectionId: section.id,
          productId,
          sortOrder: productInput.sortOrder,
          archived: productInput.archived ?? false,
        });
      }
    }
  }
}

export async function loadDraftMenuEditorView(
  tx: DbClient,
  tenantId: string,
  menuPublicId: string,
  locale: ProductLocale = "en",
): Promise<DraftMenuEditorView | null> {
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
    return null;
  }

  const menuTranslations = await tx
    .select()
    .from(catalogueMenuTranslations)
    .where(
      and(
        eq(catalogueMenuTranslations.tenantId, tenantId),
        eq(catalogueMenuTranslations.menuId, menu.id),
      ),
    );

  const translations: Record<ProductLocale, MenuTranslationView> = {
    en: {
      displayName: menu.internalName,
      description: null,
      translationVersion: 1,
    },
    ar: {
      displayName: menu.internalName,
      description: null,
      translationVersion: 1,
    },
  };

  for (const row of menuTranslations) {
    const rowLocale = row.locale as ProductLocale;
    if (rowLocale !== "en" && rowLocale !== "ar") {
      continue;
    }

    translations[rowLocale] = {
      displayName: row.displayName,
      description: row.description,
      translationVersion: row.translationVersion,
    };
  }

  const locationRows = await tx
    .select({ locationId: catalogueMenuLocations.locationId })
    .from(catalogueMenuLocations)
    .where(
      and(
        eq(catalogueMenuLocations.tenantId, tenantId),
        eq(catalogueMenuLocations.menuId, menu.id),
      ),
    );

  const sectionRows = await tx
    .select()
    .from(catalogueMenuSections)
    .where(
      and(
        eq(catalogueMenuSections.tenantId, tenantId),
        eq(catalogueMenuSections.menuId, menu.id),
      ),
    )
    .orderBy(asc(catalogueMenuSections.sortOrder));

  const sectionIds = sectionRows.map((section) => section.id);
  const sections: MenuSectionView[] = [];

  let itemCount = 0;

  if (sectionIds.length > 0) {
    const sectionTranslationRows = await tx
      .select()
      .from(catalogueMenuSectionTranslations)
      .where(
        and(
          eq(catalogueMenuSectionTranslations.tenantId, tenantId),
          inArray(catalogueMenuSectionTranslations.sectionId, sectionIds),
        ),
      );

    const placementRows = await tx
      .select({
        sectionId: catalogueMenuSectionProducts.sectionId,
        sortOrder: catalogueMenuSectionProducts.sortOrder,
        archived: catalogueMenuSectionProducts.archived,
        productPublicId: catalogueProducts.publicId,
        internalName: catalogueProducts.internalName,
        displayName: catalogueProductTranslations.displayName,
      })
      .from(catalogueMenuSectionProducts)
      .innerJoin(
        catalogueProducts,
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.id, catalogueMenuSectionProducts.productId),
        ),
      )
      .leftJoin(
        catalogueProductTranslations,
        and(
          eq(catalogueProductTranslations.tenantId, tenantId),
          eq(catalogueProductTranslations.productId, catalogueProducts.id),
          eq(catalogueProductTranslations.locale, locale),
        ),
      )
      .where(
        and(
          eq(catalogueMenuSectionProducts.tenantId, tenantId),
          inArray(catalogueMenuSectionProducts.sectionId, sectionIds),
        ),
      )
      .orderBy(asc(catalogueMenuSectionProducts.sortOrder));

    for (const section of sectionRows) {
      const sectionTranslations: Record<ProductLocale, MenuTranslationView> = {
        en: {
          displayName: section.internalName,
          description: null,
          translationVersion: 1,
        },
        ar: {
          displayName: section.internalName,
          description: null,
          translationVersion: 1,
        },
      };

      for (const row of sectionTranslationRows.filter(
        (translation) => translation.sectionId === section.id,
      )) {
        const rowLocale = row.locale as ProductLocale;
        if (rowLocale !== "en" && rowLocale !== "ar") {
          continue;
        }

        sectionTranslations[rowLocale] = {
          displayName: row.displayName,
          description: row.description,
          translationVersion: row.translationVersion,
        };
      }

      const products = placementRows
        .filter((placement) => placement.sectionId === section.id)
        .map((placement) => ({
          productPublicId: placement.productPublicId,
          internalName: placement.internalName,
          displayName: placement.displayName ?? placement.internalName,
          sortOrder: placement.sortOrder,
          archived: placement.archived,
        }));

      itemCount += products.filter((product) => !product.archived).length;

      sections.push({
        publicId: section.publicId,
        internalName: section.internalName,
        sortOrder: section.sortOrder,
        archived: section.archived,
        translations: sectionTranslations,
        products,
      });
    }
  }

  const revisionRows = await tx
    .select({
      locationId: catalogueMenuLiveRevisions.locationId,
      sourceVersion: catalogueMenuLiveRevisions.sourceVersion,
    })
    .from(catalogueMenuLiveRevisions)
    .where(
      and(
        eq(catalogueMenuLiveRevisions.tenantId, tenantId),
        eq(catalogueMenuLiveRevisions.menuId, menu.id),
      ),
    );

  const menuLocationIds = locationRows.map((row) => row.locationId);
  const isLive = revisionRows.length > 0;
  const hasUnpublishedChanges =
    revisionRows.some((row) => row.sourceVersion < menu.version) ||
    revisionRows.length < menuLocationIds.length;
  const publishedVersion =
    revisionRows.length > 0
      ? Math.max(...revisionRows.map((row) => row.sourceVersion))
      : menu.publishedVersion;

  return {
    publicId: menu.publicId,
    internalName: menu.internalName,
    status: menu.status,
    version: menu.version,
    publishedVersion,
    hasUnpublishedChanges,
    isLive,
    sectionCount: sectionRows.filter((section) => !section.archived).length,
    itemCount,
    locationIds: locationRows.map((row) => row.locationId),
    displayName: translations[locale].displayName,
    updatedAt: menu.updatedAt,
    translations,
    sections,
  };
}

export async function listDraftMenus(
  db: DbClient,
  tenantId: string,
  locale: ProductLocale = "en",
): Promise<DraftMenuSummaryView[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const menus = await tx
      .select()
      .from(catalogueMenus)
      .where(eq(catalogueMenus.tenantId, tenantId))
      .orderBy(asc(catalogueMenus.updatedAt));

    const summaries: DraftMenuSummaryView[] = [];

    for (const menu of menus) {
      const view = await loadDraftMenuEditorView(tx, tenantId, menu.publicId, locale);
      if (!view) {
        continue;
      }

      summaries.push(view);
    }

    return summaries;
  });
}

export async function createDraftMenu(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  input: CreateDraftMenuInput,
): Promise<DraftMenuEditorView> {
  try {
    const validated = validateCreateDraftMenuInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      await assertAuthorizedLocations(
        tx,
        tenantId,
        membership,
        validated.locationIds,
      );

      const brandId = await resolveBrandId(tx, tenantId, validated.brandPublicId);
      const publicId = generateMenuPublicId(validated.internalName);

      const [menu] = await tx
        .insert(catalogueMenus)
        .values({
          tenantId,
          brandId,
          publicId,
          internalName: validated.internalName,
          status: "draft",
          provenance: "operator_entered",
        })
        .returning();

      await upsertMenuTranslations(tx, tenantId, menu.id, validated.translations);
      await replaceMenuLocations(tx, tenantId, menu.id, validated.locationIds);

      if (validated.sections.length > 0) {
        await syncMenuSections(tx, tenantId, menu.id, validated.sections);
      }

      const view = await loadDraftMenuEditorView(tx, tenantId, menu.publicId);
      if (!view) {
        throw new MenuError("Unable to load created menu.", 500);
      }

      return view;
    });
  } catch (error) {
    return mapMenuError(error);
  }
}

export async function getDraftMenu(
  db: DbClient,
  tenantId: string,
  menuPublicId: string,
  locale: ProductLocale = "en",
): Promise<DraftMenuEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const view = await loadDraftMenuEditorView(
        tx,
        tenantId,
        menuPublicId,
        locale,
      );

      if (!view) {
        throw new MenuError("Menu not found.", 404);
      }

      return view;
    });
  } catch (error) {
    return mapMenuError(error);
  }
}

export async function updateDraftMenu(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  menuPublicId: string,
  input: UpdateDraftMenuInput,
): Promise<DraftMenuEditorView> {
  try {
    validateUpdateDraftMenuInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
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

      if (menu.version !== input.expectedVersion) {
        throw new MenuConflictError(
          "Menu was updated elsewhere. Reload and try again.",
          "expectedVersion",
        );
      }

      if (input.locationIds) {
        await assertAuthorizedLocations(
          tx,
          tenantId,
          membership,
          input.locationIds,
        );
      } else {
        const currentLocations = await tx
          .select({ locationId: catalogueMenuLocations.locationId })
          .from(catalogueMenuLocations)
          .where(
            and(
              eq(catalogueMenuLocations.tenantId, tenantId),
              eq(catalogueMenuLocations.menuId, menu.id),
            ),
          );

        await assertAuthorizedLocations(
          tx,
          tenantId,
          membership,
          currentLocations.map((row) => row.locationId),
        );
      }

      const [updatedMenu] = await tx
        .update(catalogueMenus)
        .set({
          internalName: input.internalName?.trim() ?? menu.internalName,
          version: menu.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueMenus.tenantId, tenantId),
            eq(catalogueMenus.id, menu.id),
            eq(catalogueMenus.version, input.expectedVersion),
          ),
        )
        .returning({ id: catalogueMenus.id });

      if (!updatedMenu) {
        throw new MenuConflictError(
          "Menu was updated elsewhere. Reload and try again.",
          "expectedVersion",
        );
      }

      if (input.translations) {
        const currentView = await loadDraftMenuEditorView(tx, tenantId, menuPublicId);
        if (!currentView) {
          throw new MenuError("Menu not found.", 404);
        }

        await upsertMenuTranslations(tx, tenantId, menu.id, {
          en: {
            displayName:
              input.translations.en?.displayName?.trim() ??
              currentView.translations.en.displayName,
            description:
              input.translations.en?.description === undefined
                ? currentView.translations.en.description
                : input.translations.en.description?.trim() || null,
          },
          ar: {
            displayName:
              input.translations.ar?.displayName?.trim() ??
              currentView.translations.ar.displayName,
            description:
              input.translations.ar?.description === undefined
                ? currentView.translations.ar.description
                : input.translations.ar.description?.trim() || null,
          },
        });
      }

      if (input.locationIds) {
        await replaceMenuLocations(tx, tenantId, menu.id, input.locationIds);
      }

      if (input.sections) {
        await syncMenuSections(tx, tenantId, menu.id, input.sections);
      }

      const view = await loadDraftMenuEditorView(tx, tenantId, menuPublicId);
      if (!view) {
        throw new MenuError("Unable to load updated menu.", 500);
      }

      return view;
    });
  } catch (error) {
    return mapMenuError(error);
  }
}

