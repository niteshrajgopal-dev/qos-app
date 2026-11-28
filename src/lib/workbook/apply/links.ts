import { and, eq } from "drizzle-orm";

import {
  catalogueCategories,
  catalogueMenus,
  catalogueMenuSections,
  catalogueModifierGroups,
  catalogueModifierOptions,
  catalogueProducts,
  catalogueVariants,
  inventoryCategories,
  inventoryItems,
  inventorySuppliers,
  inventoryUnits,
  inventoryWarehouses,
  recipes,
  recipeVersionLines,
  recipeVersionModifierEffects,
  recipeVersions,
  recipeVersionSteps,
  workbookSourceLinks,
} from "@/db/schema";
import type { DbTransaction } from "@/lib/tenant/context";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import type { AppliedLink, TypedLinkEntity } from "@/lib/workbook/apply/model";

/* Typed source links (QOS-217, decision D-LINKS): workbook key → QOS public
   id per entity type within a source namespace. Written in the same
   transaction as the record they point at, for entity sheets only (links
   between records are identified by their two endpoints). The flat
   importer's product-only `catalogue_import_source_links` is untouched. */

export const LINK_ENTITY_OF_SHEET: Record<string, TypedLinkEntity | undefined> = {
  Categories: "category",
  Products: "product",
  Variants: "variant",
  "Modifier Groups": "modifier_group",
  "Modifier Options": "modifier_option",
  Menus: "menu",
  "Menu Sections": "menu_section",
  // QOS-200. A Recipes row links its version key; its handler also links the family (`recipe`) under recipe_key.
  Units: "unit",
  Suppliers: "supplier",
  Warehouses: "warehouse",
  "Inventory Categories": "inventory_category",
  Ingredients: "inventory_item",
  Recipes: "recipe_version",
  "Recipe Lines": "recipe_line",
  "Prep Steps": "prep_step",
  "Modifier Effects": "modifier_effect",
};

const TARGET_TABLE = {
  category: catalogueCategories,
  product: catalogueProducts,
  variant: catalogueVariants,
  modifier_group: catalogueModifierGroups,
  modifier_option: catalogueModifierOptions,
  menu: catalogueMenus,
  menu_section: catalogueMenuSections,
  unit: inventoryUnits,
  supplier: inventorySuppliers,
  warehouse: inventoryWarehouses,
  inventory_category: inventoryCategories,
  inventory_item: inventoryItems,
  recipe: recipes,
  recipe_version: recipeVersions,
  recipe_line: recipeVersionLines,
  prep_step: recipeVersionSteps,
  modifier_effect: recipeVersionModifierEffects,
} as const;

const CHILD_TABLE = { recipe_line: recipeVersionLines, prep_step: recipeVersionSteps, modifier_effect: recipeVersionModifierEffects } as const;

/**
 * Whether a live link may move to another record (QOS-200, decision D4): a
 * recipe version key whose version is approved or discarded follows the new
 * draft made from it, and a line, step or effect key whose row was removed or
 * belongs to such a version follows its copy in the draft. Nothing else moves.
 */
async function frozenTarget(tx: DbTransaction, tenantId: string, entityType: TypedLinkEntity, publicId: string) {
  if (entityType === "recipe_version") {
    const [version] = await tx
      .select({ status: recipeVersions.status })
      .from(recipeVersions)
      .where(and(eq(recipeVersions.tenantId, tenantId), eq(recipeVersions.publicId, publicId)))
      .limit(1);
    return Boolean(version) && version!.status !== "draft";
  }
  if (entityType !== "recipe_line" && entityType !== "prep_step" && entityType !== "modifier_effect") return false;
  const table = CHILD_TABLE[entityType];
  const [row] = await tx
    .select({ status: table.status, versionStatus: recipeVersions.status })
    .from(table)
    .innerJoin(recipeVersions, and(eq(recipeVersions.tenantId, table.tenantId), eq(recipeVersions.id, table.recipeVersionId)))
    .where(and(eq(table.tenantId, tenantId), eq(table.publicId, publicId)))
    .limit(1);
  return Boolean(row) && (row!.status === "removed" || row!.versionStatus !== "draft");
}

async function targetExists(tx: DbTransaction, tenantId: string, entityType: TypedLinkEntity, publicId: string) {
  const table = TARGET_TABLE[entityType];
  const [row] = await tx
    .select({ publicId: table.publicId })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.publicId, publicId)))
    .limit(1);
  return Boolean(row);
}

export async function findTypedLinks(tx: DbTransaction, tenantId: string, namespace: string) {
  return tx
    .select()
    .from(workbookSourceLinks)
    .where(and(eq(workbookSourceLinks.tenantId, tenantId), eq(workbookSourceLinks.sourceNamespace, namespace)));
}

/**
 * Links a workbook key to the record a unit just saved (created or updated). A link left
 * behind by a record that no longer exists is repointed (the review already
 * treated it as no link); a live link to another record is never moved,
 * because the unique target index refuses a second key for one record,
 * except a frozen recipe version (or its line, step or effect), whose key
 * follows the draft made from it (QOS-200, D4).
 */
export async function writeTypedLinkInTx(
  tx: DbTransaction,
  input: {
    tenantId: string;
    namespace: string;
    sheet: string;
    sourceKey: string;
    targetPublicId: string;
    planId: string;
    applyId: string;
    subject: string;
    /** Overrides the sheet's entity type (the recipe family link of a Recipes row). */
    entityType?: TypedLinkEntity;
  },
): Promise<AppliedLink | null> {
  const entityType = input.entityType ?? LINK_ENTITY_OF_SHEET[input.sheet];
  if (!entityType || !input.sourceKey) return null;
  // A key that is the record's own QOS id (an export row) identifies it already; it needs no link (QOS-200).
  if (input.sourceKey === input.targetPublicId) return null;
  const [existing] = await tx
    .select({ targetPublicId: workbookSourceLinks.targetPublicId })
    .from(workbookSourceLinks)
    .where(
      and(
        eq(workbookSourceLinks.tenantId, input.tenantId),
        eq(workbookSourceLinks.sourceNamespace, input.namespace),
        eq(workbookSourceLinks.entityType, entityType),
        eq(workbookSourceLinks.sourceKey, input.sourceKey),
      ),
    )
    .limit(1);
  if (
    existing &&
    existing.targetPublicId !== input.targetPublicId &&
    (await targetExists(tx, input.tenantId, entityType, existing.targetPublicId)) &&
    !(await frozenTarget(tx, input.tenantId, entityType, existing.targetPublicId))
  ) {
    throw new ApplyUnitError("conflict", "This workbook key is already linked to another record.", { reason: "key_linked_elsewhere" });
  }
  if (!existing || existing.targetPublicId !== input.targetPublicId) {
    // One key per record and namespace: a record already linked under another key keeps that link (QOS-200).
    const [byTarget] = await tx
      .select({ sourceKey: workbookSourceLinks.sourceKey })
      .from(workbookSourceLinks)
      .where(
        and(
          eq(workbookSourceLinks.tenantId, input.tenantId),
          eq(workbookSourceLinks.sourceNamespace, input.namespace),
          eq(workbookSourceLinks.entityType, entityType),
          eq(workbookSourceLinks.targetPublicId, input.targetPublicId),
        ),
      )
      .limit(1);
    if (byTarget && byTarget.sourceKey !== input.sourceKey) return null;
  }
  const now = new Date();
  await tx
    .insert(workbookSourceLinks)
    .values({
      tenantId: input.tenantId,
      sourceNamespace: input.namespace,
      entityType,
      sourceKey: input.sourceKey,
      targetPublicId: input.targetPublicId,
      planId: input.planId,
      applyId: input.applyId,
      createdBySubject: input.subject,
    })
    .onConflictDoUpdate({
      target: [workbookSourceLinks.tenantId, workbookSourceLinks.sourceNamespace, workbookSourceLinks.entityType, workbookSourceLinks.sourceKey],
      set: { targetPublicId: input.targetPublicId, planId: input.planId, applyId: input.applyId, updatedAt: now },
    });
  return { namespace: input.namespace, entityType, sourceKey: input.sourceKey, targetPublicId: input.targetPublicId };
}
