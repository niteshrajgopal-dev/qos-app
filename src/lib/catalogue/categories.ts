import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueCategories,
  catalogueCategoryTranslations,
  catalogueProductCategories,
  catalogueProductTranslations,
  catalogueProducts,
} from "@/db/schema";
import {
  type AssignCategoryProductInput,
  type CreateCategoryInput,
  type ReorderCategoriesInput,
  type UpdateCategoryInput,
  validateAssignCategoryProductInput,
  validateCreateCategoryInput,
  validateReorderCategoriesInput,
  validateUpdateCategoryInput,
} from "@/lib/catalogue/category-validation";
import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class CatalogueCategoryError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CatalogueCategoryError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class CatalogueCategoryConflictError extends CatalogueCategoryError {
  constructor(message: string, field?: string) {
    super(message, 409, field);
    this.name = "CatalogueCategoryConflictError";
  }
}

export type CategoryProductView = {
  productPublicId: string;
  internalName: string;
  displayName: string;
};

export type CategorySummaryView = {
  publicId: string;
  internalName: string;
  sortOrder: number;
  version: number;
  status: "active" | "archived";
  productCount: number;
  translations: Record<ProductLocale, { displayName: string }>;
};

export type CategoryEditorView = CategorySummaryView & {
  products: CategoryProductView[];
};

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "category"
  );
}

function generateCategoryPublicId(internalName: string) {
  return `cat_${slugify(internalName).replace(/-/g, "_")}_${randomUUID().slice(0, 8)}`;
}

function mapCatalogueError(error: unknown): never {
  if (error instanceof CatalogueValidationError) {
    throw new CatalogueCategoryError(error.message, 400, error.field);
  }

  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof CatalogueCategoryError) {
    throw error;
  }

  throw error;
}

function emptyTranslations(): Record<ProductLocale, { displayName: string }> {
  return {
    en: { displayName: "" },
    ar: { displayName: "" },
  };
}

async function upsertTranslations(
  tx: DbClient,
  tenantId: string,
  categoryId: string,
  translations:
    | Partial<Record<ProductLocale, { displayName: string }>>
    | undefined,
) {
  if (!translations) {
    return;
  }

  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    if (!translation) {
      continue;
    }

    const [existing] = await tx
      .select({ id: catalogueCategoryTranslations.id })
      .from(catalogueCategoryTranslations)
      .where(
        and(
          eq(catalogueCategoryTranslations.tenantId, tenantId),
          eq(catalogueCategoryTranslations.categoryId, categoryId),
          eq(catalogueCategoryTranslations.locale, locale),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(catalogueCategoryTranslations)
        .set({
          displayName: translation.displayName,
          updatedAt: new Date(),
        })
        .where(eq(catalogueCategoryTranslations.id, existing.id));
      continue;
    }

    await tx.insert(catalogueCategoryTranslations).values({
      tenantId,
      categoryId,
      locale,
      displayName: translation.displayName,
    });
  }
}

async function loadCategoryByPublicId(
  tx: DbClient,
  tenantId: string,
  publicId: string,
) {
  const [category] = await tx
    .select()
    .from(catalogueCategories)
    .where(
      and(
        eq(catalogueCategories.tenantId, tenantId),
        eq(catalogueCategories.publicId, publicId),
      ),
    )
    .limit(1);

  if (!category) {
    throw new CatalogueCategoryError("Category not found.", 404, "publicId");
  }

  return category;
}

async function bumpCategoryVersion(
  tx: DbClient,
  tenantId: string,
  categoryId: string,
  expectedVersion: number,
) {
  const [updated] = await tx
    .update(catalogueCategories)
    .set({
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogueCategories.tenantId, tenantId),
        eq(catalogueCategories.id, categoryId),
        eq(catalogueCategories.version, expectedVersion),
      ),
    )
    .returning({ version: catalogueCategories.version });

  if (!updated) {
    throw new CatalogueCategoryConflictError(
      "Category version conflict.",
      "expectedVersion",
    );
  }

  return updated.version;
}

async function loadCategoryEditorView(
  tx: DbClient,
  tenantId: string,
  categoryId: string,
): Promise<CategoryEditorView> {
  const [category] = await tx
    .select()
    .from(catalogueCategories)
    .where(
      and(
        eq(catalogueCategories.tenantId, tenantId),
        eq(catalogueCategories.id, categoryId),
      ),
    )
    .limit(1);

  if (!category) {
    throw new CatalogueCategoryError("Category not found.", 404, "publicId");
  }

  const translationRows = await tx
    .select()
    .from(catalogueCategoryTranslations)
    .where(
      and(
        eq(catalogueCategoryTranslations.tenantId, tenantId),
        eq(catalogueCategoryTranslations.categoryId, categoryId),
      ),
    );

  const translations = emptyTranslations();
  for (const row of translationRows) {
    if (row.locale === "en" || row.locale === "ar") {
      translations[row.locale] = { displayName: row.displayName };
    }
  }

  const assignments = await tx
    .select({
      productPublicId: catalogueProducts.publicId,
      internalName: catalogueProducts.internalName,
      displayName: catalogueProductTranslations.displayName,
    })
    .from(catalogueProductCategories)
    .innerJoin(
      catalogueProducts,
      and(
        eq(catalogueProducts.tenantId, catalogueProductCategories.tenantId),
        eq(catalogueProducts.id, catalogueProductCategories.productId),
      ),
    )
    .leftJoin(
      catalogueProductTranslations,
      and(
        eq(catalogueProductTranslations.tenantId, catalogueProducts.tenantId),
        eq(catalogueProductTranslations.productId, catalogueProducts.id),
        eq(catalogueProductTranslations.locale, "en"),
      ),
    )
    .where(
      and(
        eq(catalogueProductCategories.tenantId, tenantId),
        eq(catalogueProductCategories.categoryId, categoryId),
      ),
    )
    .orderBy(asc(catalogueProductCategories.sortOrder));

  return {
    publicId: category.publicId,
    internalName: category.internalName,
    sortOrder: category.sortOrder,
    version: category.version,
    status: category.status === "archived" ? "archived" : "active",
    productCount: assignments.length,
    translations,
    products: assignments.map((row) => ({
      productPublicId: row.productPublicId,
      internalName: row.internalName,
      displayName: row.displayName || row.internalName,
    })),
  };
}

export async function listCategories(
  db: DbClient,
  tenantId: string,
): Promise<CategorySummaryView[]> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const categories = await tx
        .select()
        .from(catalogueCategories)
        .where(eq(catalogueCategories.tenantId, tenantId))
        .orderBy(asc(catalogueCategories.sortOrder), asc(catalogueCategories.createdAt));

      if (categories.length === 0) {
        return [];
      }

      const categoryIds = categories.map((category) => category.id);
      const translationRows = await tx
        .select()
        .from(catalogueCategoryTranslations)
        .where(
          and(
            eq(catalogueCategoryTranslations.tenantId, tenantId),
            inArray(catalogueCategoryTranslations.categoryId, categoryIds),
          ),
        );

      const counts = await tx
        .select({
          categoryId: catalogueProductCategories.categoryId,
          count: sql<number>`count(*)::int`,
        })
        .from(catalogueProductCategories)
        .where(
          and(
            eq(catalogueProductCategories.tenantId, tenantId),
            inArray(catalogueProductCategories.categoryId, categoryIds),
          ),
        )
        .groupBy(catalogueProductCategories.categoryId);

      const countById = new Map(counts.map((row) => [row.categoryId, row.count]));

      return categories.map((category) => {
        const translations = emptyTranslations();
        for (const row of translationRows) {
          if (
            row.categoryId === category.id &&
            (row.locale === "en" || row.locale === "ar")
          ) {
            translations[row.locale] = { displayName: row.displayName };
          }
        }

        return {
          publicId: category.publicId,
          internalName: category.internalName,
          sortOrder: category.sortOrder,
          version: category.version,
          status: category.status === "archived" ? "archived" : "active",
          productCount: countById.get(category.id) ?? 0,
          translations,
        };
      });
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function getCategory(
  db: DbClient,
  tenantId: string,
  publicId: string,
): Promise<CategoryEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const category = await loadCategoryByPublicId(tx, tenantId, publicId);
      return loadCategoryEditorView(tx, tenantId, category.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function createCategory(
  db: DbClient,
  tenantId: string,
  input: CreateCategoryInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<CategoryEditorView> {
  try {
    const validated = validateCreateCategoryInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      if (validated.publicId) {
        const [existing] = await tx
          .select({ id: catalogueCategories.id })
          .from(catalogueCategories)
          .where(
            and(
              eq(catalogueCategories.tenantId, tenantId),
              eq(catalogueCategories.publicId, validated.publicId),
            ),
          )
          .limit(1);

        if (existing) {
          return loadCategoryEditorView(tx, tenantId, existing.id);
        }
      }

      const publicId =
        validated.publicId ?? generateCategoryPublicId(validated.internalName);

      const [category] = await tx
        .insert(catalogueCategories)
        .values({
          tenantId,
          publicId,
          internalName: validated.internalName,
          sortOrder: validated.sortOrder,
          provenance: "operator_entered",
        })
        .returning();

      await upsertTranslations(tx, tenantId, category.id, validated.translations);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.category.create",
        entityType: "catalogue_category",
        entityPublicId: publicId,
        entityVersion: category.version,
        changeSummary: { sortOrder: validated.sortOrder },
      });

      return loadCategoryEditorView(tx, tenantId, category.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateCategory(
  db: DbClient,
  tenantId: string,
  publicId: string,
  input: UpdateCategoryInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<CategoryEditorView> {
  try {
    const validated = validateUpdateCategoryInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const category = await loadCategoryByPublicId(tx, tenantId, publicId);
      const nextVersion = await bumpCategoryVersion(
        tx,
        tenantId,
        category.id,
        validated.expectedVersion,
      );

      await tx
        .update(catalogueCategories)
        .set({
          internalName: validated.internalName ?? category.internalName,
          sortOrder: validated.sortOrder ?? category.sortOrder,
          status: validated.status ?? category.status,
          updatedAt: new Date(),
        })
        .where(eq(catalogueCategories.id, category.id));

      await upsertTranslations(tx, tenantId, category.id, validated.translations);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.category.update",
        entityType: "catalogue_category",
        entityPublicId: publicId,
        entityVersion: nextVersion,
        changeSummary: {
          status: validated.status ?? category.status,
        },
      });

      return loadCategoryEditorView(tx, tenantId, category.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function reorderCategories(
  db: DbClient,
  tenantId: string,
  input: ReorderCategoriesInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<CategorySummaryView[]> {
  try {
    const validated = validateReorderCategoriesInput(input);

    await withTenantContext(db, tenantId, async (tx) => {
      const categories = await tx
        .select()
        .from(catalogueCategories)
        .where(eq(catalogueCategories.tenantId, tenantId));

      const byPublicId = new Map(
        categories.map((category) => [category.publicId, category]),
      );

      if (validated.orderedPublicIds.length !== categories.length) {
        throw new CatalogueCategoryError(
          "orderedPublicIds must include every category exactly once.",
          400,
          "orderedPublicIds",
        );
      }

      for (const publicId of validated.orderedPublicIds) {
        if (!byPublicId.has(publicId)) {
          throw new CatalogueCategoryError(
            "Unknown category in reorder list.",
            404,
            "orderedPublicIds",
          );
        }
      }

      for (const [index, publicId] of validated.orderedPublicIds.entries()) {
        const category = byPublicId.get(publicId);
        if (!category) {
          continue;
        }

        await tx
          .update(catalogueCategories)
          .set({
            sortOrder: index,
            version: category.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(catalogueCategories.id, category.id));
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.category.reorder",
        entityType: "catalogue_category",
        entityPublicId: validated.orderedPublicIds[0] ?? "cat_unknown",
        entityVersion: 1,
        changeSummary: { orderedPublicIds: validated.orderedPublicIds },
      });
    });

    return listCategories(db, tenantId);
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function assignProductToCategory(
  db: DbClient,
  tenantId: string,
  categoryPublicId: string,
  input: AssignCategoryProductInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<CategoryEditorView> {
  try {
    const validated = validateAssignCategoryProductInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const category = await loadCategoryByPublicId(tx, tenantId, categoryPublicId);
      const [product] = await tx
        .select()
        .from(catalogueProducts)
        .where(
          and(
            eq(catalogueProducts.tenantId, tenantId),
            eq(catalogueProducts.publicId, validated.productPublicId),
          ),
        )
        .limit(1);

      if (!product) {
        throw new CatalogueCategoryError("Product not found.", 404, "productPublicId");
      }

      await tx
        .insert(catalogueProductCategories)
        .values({
          tenantId,
          categoryId: category.id,
          productId: product.id,
        })
        .onConflictDoNothing();

      await bumpCategoryVersion(tx, tenantId, category.id, category.version);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.category.assign_product",
        entityType: "catalogue_category",
        entityPublicId: categoryPublicId,
        entityVersion: category.version + 1,
        changeSummary: { productPublicId: validated.productPublicId },
      });

      return loadCategoryEditorView(tx, tenantId, category.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function unassignProductFromCategory(
  db: DbClient,
  tenantId: string,
  categoryPublicId: string,
  productPublicId: string,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<CategoryEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const category = await loadCategoryByPublicId(tx, tenantId, categoryPublicId);
      const [product] = await tx
        .select()
        .from(catalogueProducts)
        .where(
          and(
            eq(catalogueProducts.tenantId, tenantId),
            eq(catalogueProducts.publicId, productPublicId),
          ),
        )
        .limit(1);

      if (!product) {
        throw new CatalogueCategoryError("Product not found.", 404, "productPublicId");
      }

      await tx
        .delete(catalogueProductCategories)
        .where(
          and(
            eq(catalogueProductCategories.tenantId, tenantId),
            eq(catalogueProductCategories.categoryId, category.id),
            eq(catalogueProductCategories.productId, product.id),
          ),
        );

      await bumpCategoryVersion(tx, tenantId, category.id, category.version);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.category.unassign_product",
        entityType: "catalogue_category",
        entityPublicId: categoryPublicId,
        entityVersion: category.version + 1,
        changeSummary: { productPublicId },
      });

      return loadCategoryEditorView(tx, tenantId, category.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}
