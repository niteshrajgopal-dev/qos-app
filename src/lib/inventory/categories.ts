import { and, asc, count, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { type InventoryCategoryRecord, inventoryCategories, inventoryItems } from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { type Dependency, InventoryConflictError, InventoryDependencyError, InventoryError } from "@/lib/inventory/errors";
import {
  asBody,
  type CategoryView,
  loadCategoryByPublicIdInTx,
  loadTenantCategoriesInTx,
  parseExpectedVersion,
  parseOptionalName,
  parseRequiredName,
  parseStatus,
  requireInventoryAdministrator,
  shortRandomHex,
  slugify,
  toCategoryView,
  uniqueViolationConstraint,
  versionConflict,
} from "@/lib/inventory/shared";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-197 inventory categories: a flat vocabulary for filtering and reporting
   items, separate from menu categories. A category's identity is its public
   id; a rename changes the names only, so every item keeps its category. At
   most one active category has a given English name (case and outer spaces
   ignored); archived categories keep theirs as history. Categories are never
   deleted; archiving is refused while an active item is in the category. */

export const CATEGORY_NAME_MAX_LENGTH = 120;

export type CategorySummaryView = CategoryView & {
  /** Items (active and archived) in this category. */
  itemCount: number;
  /** Active items in this category; archiving is refused while this is above zero. */
  activeItemCount: number;
};

export type CategoryItemView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: "purchased" | "prepared";
  status: "active" | "archived";
};

export type CategoryDetailView = {
  category: CategoryView;
  /** Items (active and archived) in this category. */
  items: CategoryItemView[];
  /** What would block archiving right now. */
  dependencies: Dependency[];
};

type CategoryFields = { nameEn: string; nameAr: string | null };

/** Parses the name fields present in `body`; omitted fields are left out of the result. */
export function parseCategoryFields(body: Record<string, unknown>, requireName: boolean): Partial<CategoryFields> {
  const result: Partial<CategoryFields> = {};
  if (requireName || body.nameEn !== undefined) {
    result.nameEn = parseRequiredName(body.nameEn, "nameEn", CATEGORY_NAME_MAX_LENGTH);
  }
  if (body.nameAr !== undefined) {
    result.nameAr = parseOptionalName(body.nameAr, "nameAr", CATEGORY_NAME_MAX_LENGTH);
  }
  return result;
}

function mapCategoryWriteError(error: unknown): never {
  if (uniqueViolationConstraint(error) === "inventory_categories_active_name_unique") {
    throw new InventoryConflictError(
      "Another active category already has this English name.",
      "category_name_taken",
      "nameEn",
    );
  }
  throw error;
}

function generateCategoryPublicId(nameEn: string) {
  return `invcat_${slugify(nameEn, "category")}_${shortRandomHex(8)}`;
}

function auditCategory(row: InventoryCategoryRecord) {
  return { nameEn: row.nameEn, nameAr: row.nameAr, status: row.status };
}

/**
 * Records that would block archiving the category: active items in it. An
 * archived item keeps its category as history and does not block.
 */
export async function categoryDependencies(tx: DbClient, tenantId: string, categoryId: string): Promise<Dependency[]> {
  const [items] = await tx
    .select({ value: count() })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.categoryId, categoryId),
        eq(inventoryItems.status, "active"),
      ),
    );
  const itemCount = items?.value ?? 0;
  return itemCount > 0 ? [{ kind: "inventory_items", count: itemCount }] : [];
}

async function loadCategoryDetailInTx(
  tx: DbClient,
  tenantId: string,
  category: InventoryCategoryRecord,
): Promise<CategoryDetailView> {
  const items = await tx
    .select({
      publicId: inventoryItems.publicId,
      nameEn: inventoryItems.nameEn,
      nameAr: inventoryItems.nameAr,
      kind: inventoryItems.kind,
      status: inventoryItems.status,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.categoryId, category.id)))
    .orderBy(asc(inventoryItems.nameEn), asc(inventoryItems.publicId));
  return {
    category: toCategoryView(category),
    items,
    dependencies: await categoryDependencies(tx, tenantId, category.id),
  };
}

export async function listCategories(db: DbClient, tenantId: string): Promise<{ categories: CategorySummaryView[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await loadTenantCategoriesInTx(tx, tenantId);
    const assigned = await tx
      .select({ categoryId: inventoryItems.categoryId, status: inventoryItems.status })
      .from(inventoryItems)
      .where(eq(inventoryItems.tenantId, tenantId));
    return {
      categories: rows.map((row) => {
        const items = assigned.filter((item) => item.categoryId === row.id);
        return {
          ...toCategoryView(row),
          itemCount: items.length,
          activeItemCount: items.filter((item) => item.status === "active").length,
        };
      }),
    };
  });
}

export async function getCategory(db: DbClient, tenantId: string, categoryPublicId: string): Promise<CategoryDetailView> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [category] = await tx
      .select()
      .from(inventoryCategories)
      .where(and(eq(inventoryCategories.tenantId, tenantId), eq(inventoryCategories.publicId, categoryPublicId)))
      .limit(1);
    if (!category) {
      throw new InventoryError("Category not found.", 404, "category_not_found", "categoryPublicId");
    }
    return loadCategoryDetailInTx(tx, tenantId, category);
  });
}

export async function createCategory(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
): Promise<CategoryDetailView> {
  requireInventoryAdministrator(membership);
  const fields = parseCategoryFields(asBody(input), true) as Partial<CategoryFields> & { nameEn: string };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(inventoryCategories)
        .values({
          tenantId,
          publicId: generateCategoryPublicId(fields.nameEn),
          nameEn: fields.nameEn,
          nameAr: fields.nameAr ?? null,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "inventory.category.create",
        entityType: "inventory_category",
        entityPublicId: row!.publicId,
        entityVersion: row!.version,
        changeSummary: { after: auditCategory(row!) },
      });
      return loadCategoryDetailInTx(tx, tenantId, row!);
    });
  } catch (error) {
    return mapCategoryWriteError(error);
  }
}

export async function updateCategory(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  categoryPublicId: string,
  input: unknown,
): Promise<CategoryDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const fields = parseCategoryFields(body, false);
  const status = parseStatus(body.status);
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const category = await loadCategoryByPublicIdInTx(tx, tenantId, categoryPublicId, "categoryPublicId", "update");
      if (category.version !== expectedVersion) {
        throw versionConflict();
      }
      const nextStatus = status ?? category.status;
      if (nextStatus === "archived" && category.status !== "archived") {
        const dependencies = await categoryDependencies(tx, tenantId, category.id);
        if (dependencies.length > 0) {
          throw new InventoryDependencyError(
            "Active items are still in this category. Move or archive them first.",
            "category_in_use",
            "status",
            dependencies,
          );
        }
      }
      const [updated] = await tx
        .update(inventoryCategories)
        .set({
          ...fields,
          status: nextStatus,
          version: category.version + 1,
          updatedAt: new Date(),
          updatedBySubject: actorSubject,
        })
        .where(and(eq(inventoryCategories.id, category.id), eq(inventoryCategories.version, expectedVersion)))
        .returning();
      if (!updated) {
        throw versionConflict();
      }
      const action =
        nextStatus !== category.status
          ? nextStatus === "archived"
            ? "inventory.category.archive"
            : "inventory.category.restore"
          : "inventory.category.update";
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action,
        entityType: "inventory_category",
        entityPublicId: updated.publicId,
        entityVersion: updated.version,
        changeSummary: { before: auditCategory(category), after: auditCategory(updated) },
      });
      return loadCategoryDetailInTx(tx, tenantId, updated);
    });
  } catch (error) {
    return mapCategoryWriteError(error);
  }
}
