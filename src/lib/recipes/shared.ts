import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryUnitRecord,
  type RecipeRecord,
  type RecipeVersionRecord,
  catalogueProducts,
  catalogueVariants,
  inventoryItems,
  recipes,
  recipeVersions,
} from "@/db/schema";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import { parseFactorMicros } from "@/lib/inventory/quantity-math";
import { loadUnitByPublicIdInTx, shortRandomHex, slugify } from "@/lib/inventory/shared";

/* QOS-198 helpers shared by the recipe, version, link and resolution
   services: public ids, loaders that filter by tenant (so another business's
   id is a 404 even before RLS), and the exact quantity parser. Errors reuse
   InventoryError so the routes and the staff UI keep one error path. */

export const RECIPE_NAME_MAX_LENGTH = 120;
export const RECIPE_NOTES_MAX_LENGTH = 1000;
export const LABEL_MAX_LENGTH = 120;
export const STEP_TEXT_MAX_LENGTH = 1000;
export const MAX_LINES = 200;
export const MAX_STEPS = 50;

export function generateRecipePublicId(nameEn: string) {
  return `rec_${slugify(nameEn, "recipe")}_${shortRandomHex(8)}`;
}

export const generateVersionPublicId = () => `recv_${shortRandomHex(16)}`;
export const generateLinePublicId = () => `recl_${shortRandomHex(16)}`;
export const generateStepPublicId = () => `recs_${shortRandomHex(16)}`;
export const generateLinkPublicId = () => `link_${shortRandomHex(16)}`;

export async function loadRecipeByPublicIdInTx(
  tx: DbClient,
  tenantId: string,
  publicId: unknown,
  lock?: "share" | "update",
  field = "recipePublicId",
): Promise<RecipeRecord> {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Recipe not found.", 404, "recipe_not_found", field);
  }
  const query = tx
    .select()
    .from(recipes)
    .where(and(eq(recipes.tenantId, tenantId), eq(recipes.publicId, publicId)))
    .limit(1);
  const [row] = lock ? await query.for(lock) : await query;
  if (!row) {
    throw new InventoryError("Recipe not found.", 404, "recipe_not_found", field);
  }
  return row;
}

export async function loadVersionByPublicIdInTx(
  tx: DbClient,
  tenantId: string,
  recipeId: string,
  publicId: unknown,
  lock?: "update",
  field = "versionPublicId",
): Promise<RecipeVersionRecord> {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Recipe version not found.", 404, "version_not_found", field);
  }
  const query = tx
    .select()
    .from(recipeVersions)
    .where(
      and(eq(recipeVersions.tenantId, tenantId), eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.publicId, publicId)),
    )
    .limit(1);
  const [row] = lock ? await query.for(lock) : await query;
  if (!row) {
    throw new InventoryError("Recipe version not found.", 404, "version_not_found", field);
  }
  return row;
}

/** The sold variant with its product's status, stock-product flag and selling basis. */
export async function loadVariantByPublicIdInTx(tx: DbClient, tenantId: string, publicId: unknown, field = "variantPublicId") {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Variant not found.", 404, "variant_not_found", field);
  }
  const [row] = await tx
    .select({
      id: catalogueVariants.id,
      publicId: catalogueVariants.publicId,
      status: catalogueVariants.status,
      sellingQuantityBasis: catalogueVariants.sellingQuantityBasis,
      productId: catalogueProducts.id,
      productPublicId: catalogueProducts.publicId,
      productStatus: catalogueProducts.status,
      directStockIntent: catalogueProducts.directStockIntent,
    })
    .from(catalogueVariants)
    .innerJoin(
      catalogueProducts,
      and(eq(catalogueProducts.tenantId, catalogueVariants.tenantId), eq(catalogueProducts.id, catalogueVariants.productId)),
    )
    .where(and(eq(catalogueVariants.tenantId, tenantId), eq(catalogueVariants.publicId, publicId)))
    .limit(1);
  if (!row) {
    throw new InventoryError("Variant not found.", 404, "variant_not_found", field);
  }
  return row;
}

export function assertRecipeActive(recipe: RecipeRecord) {
  if (recipe.status !== "active") {
    throw new InventoryConflictError(
      "This recipe is archived. Restore it before changing it or linking it.",
      "recipe_archived",
      "recipePublicId",
    );
  }
}

/** Approved and discarded versions are read-only: every edit goes through a draft. */
export function assertDraft(version: RecipeVersionRecord) {
  if (version.status !== "draft") {
    throw new InventoryConflictError(
      "Approved and discarded versions are read-only. Create a draft from this version to change the recipe.",
      "version_not_draft",
      "versionPublicId",
    );
  }
}

export function assertUnitActive(unit: InventoryUnitRecord, field: string) {
  if (unit.status !== "active") {
    throw new InventoryError("Archived units cannot be used here. Restore the unit first.", 400, "unit_archived", field);
  }
}

const QUANTITY_MESSAGES = {
  invalid: "Enter the quantity as a plain decimal number, for example 250 or 0.5.",
  not_positive: "The quantity must be greater than zero.",
  too_precise: "This quantity has more decimal places than the unit allows.",
} as const;

/**
 * Parses an exact positive quantity ("250", "0.125") into micros and checks
 * it against the unit's decimal places. Refuses, never rounds. `prefix`
 * names the error codes: quantity_* for lines and links, yield_* for yields.
 */
export function parseUnitQuantity(
  value: unknown,
  unit: { decimalPlaces: number } | null,
  field: string,
  prefix: "quantity" | "yield",
): bigint {
  const parsed = parseFactorMicros(typeof value === "string" ? value.trim() : value);
  if (parsed.status === "invalid") {
    const reason =
      parsed.code === "factor_not_positive" ? "not_positive" : parsed.code === "factor_too_precise" ? "too_precise" : "invalid";
    throw new InventoryError(QUANTITY_MESSAGES[reason], 400, `${prefix}_${reason}`, field);
  }
  if (unit) {
    assertMicrosPrecision(parsed.micros, unit, field, prefix);
  }
  return parsed.micros;
}

/** Refuses a stored quantity with more fraction digits than the unit allows. */
export function assertMicrosPrecision(
  micros: bigint,
  unit: { decimalPlaces: number },
  field: string,
  prefix: "quantity" | "yield",
) {
  const step = BigInt(10) ** BigInt(6 - Math.min(6, unit.decimalPlaces));
  if (micros % step !== BigInt(0)) {
    throw new InventoryError(QUANTITY_MESSAGES.too_precise, 400, `${prefix}_too_precise`, field);
  }
}

export function parseOptionalLabel(value: unknown, field: string, max: number, code: string): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new InventoryError("Enter this value as text.", 400, "body_invalid", field);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > max) {
    throw new InventoryError(`This text can be at most ${max} characters.`, 400, code, field);
  }
  return trimmed;
}

/**
 * Loads an item another record is about to reference. Share-locked so an
 * archive (which update-locks the item) cannot commit around the new
 * reference. Archived items are refused.
 */
export async function loadReferencedItemInTx(tx: DbClient, tenantId: string, publicId: unknown, field: string) {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Item not found.", 404, "item_not_found", field);
  }
  const [row] = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.publicId, publicId)))
    .limit(1)
    .for("share");
  if (!row) {
    throw new InventoryError("Item not found.", 404, "item_not_found", field);
  }
  if (row.status !== "active") {
    throw new InventoryError("This item is archived. Restore it before using it here.", 400, "item_archived", field);
  }
  return row;
}

/** Loads an active unit another record is about to reference (share lock, like loadUnitByPublicIdInTx). */
export async function loadReferencedUnitInTx(tx: DbClient, tenantId: string, publicId: unknown, field: string) {
  const unit = await loadUnitByPublicIdInTx(tx, tenantId, publicId, field);
  assertUnitActive(unit, field);
  return unit;
}
