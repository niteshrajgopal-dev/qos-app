import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  inventoryItemConversions,
  inventoryItems,
  recipes,
  recipeSellableLinks,
  recipeVersionLines,
  recipeVersions,
} from "@/db/schema";
import { InventoryError } from "@/lib/inventory/errors";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import { loadTenantUnitsInTx, tenantToday } from "@/lib/inventory/shared";
import { isCalendarDate } from "@/lib/catalogue/selling-tax-cost";
import { resolveConsumption, type LineUsageStatus, type UnresolvedReason } from "@/lib/recipes/resolution";
import { loadVariantByPublicIdInTx } from "@/lib/recipes/shared";
import { type DecimalView, type ItemRef, itemRef, loadVariantRowsInTx, quantityView, toGraphUnit } from "@/lib/recipes/views";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-198 consumption preview: loads the inputs for one variant and runs the
   pure resolver (resolution.ts). Read-only: it never writes, posts or moves
   stock. Any active member may read it. */

export const MAX_PREVIEW_QUANTITY = 1000;

export type ConsumptionLineView = {
  linePublicId: string | null;
  item: ItemRef;
  /** The line as entered: whole-yield quantity for a recipe, per-sale quantity for a direct-stock link. */
  quantity: string;
  unitCode: string;
  status: LineUsageStatus;
  prepared: boolean;
  storageUnitCode: string | null;
  perSale: DecimalView | null;
  total: DecimalView | null;
};

export type ConsumptionPreviewView = {
  variantPublicId: string;
  productNameEn: string;
  productNameAr: string | null;
  variantNameEn: string | null;
  variantNameAr: string | null;
  businessDate: string;
  soldQuantity: number;
  status: "resolved" | "unresolved";
  kind: "recipe" | "direct_stock" | null;
  reason: UnresolvedReason | null;
  linkPublicId: string | null;
  recipe: { publicId: string; nameEn: string; nameAr: string | null } | null;
  version: { publicId: string; versionNumber: number; yieldQuantity: string; yieldUnitCode: string } | null;
  /** Version numbers when more than one approved version applies (never silently picked). */
  overlappingVersionNumbers: number[];
  lines: ConsumptionLineView[];
  complete: boolean;
};

function parseSoldQuantity(value: string | null): number {
  if (value === null || value === "") return 1;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_PREVIEW_QUANTITY) {
    throw new InventoryError(
      `Enter a whole number of sales from 1 to ${MAX_PREVIEW_QUANTITY}.`,
      400,
      "quantity_invalid",
      "quantity",
    );
  }
  return Number(value);
}

export async function getConsumptionPreview(
  db: DbClient,
  tenantId: string,
  query: { variantPublicId: string | null; date: string | null; quantity: string | null },
  now: Date = new Date(),
): Promise<ConsumptionPreviewView> {
  const soldQuantity = parseSoldQuantity(query.quantity);
  if (query.date !== null && query.date !== "" && !isCalendarDate(query.date)) {
    throw new InventoryError("Enter a date as YYYY-MM-DD.", 400, "effective_from_invalid", "date");
  }
  return withTenantContext(db, tenantId, async (tx) => {
    const variant = await loadVariantByPublicIdInTx(tx, tenantId, query.variantPublicId);
    const businessDate = query.date || (await tenantToday(tx, tenantId, now));
    const links = await tx
      .select()
      .from(recipeSellableLinks)
      .where(and(eq(recipeSellableLinks.tenantId, tenantId), eq(recipeSellableLinks.variantId, variant.id)));
    const recipeIds = [...new Set(links.map((link) => link.recipeId).filter((id): id is string => id !== null))];
    const families = recipeIds.length
      ? await tx.select().from(recipes).where(and(eq(recipes.tenantId, tenantId), inArray(recipes.id, recipeIds)))
      : [];
    const versions = recipeIds.length
      ? await tx
          .select()
          .from(recipeVersions)
          .where(and(eq(recipeVersions.tenantId, tenantId), inArray(recipeVersions.recipeId, recipeIds)))
      : [];
    const versionIds = versions.map((version) => version.id);
    const lines = versionIds.length
      ? await tx
          .select()
          .from(recipeVersionLines)
          .where(and(eq(recipeVersionLines.tenantId, tenantId), inArray(recipeVersionLines.recipeVersionId, versionIds)))
      : [];
    const sortedLines = [...lines].sort((a, b) => a.position - b.position);
    const units = await loadTenantUnitsInTx(tx, tenantId);
    const items = await tx.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    const rules = await tx.select().from(inventoryItemConversions).where(eq(inventoryItemConversions.tenantId, tenantId));

    const result = resolveConsumption({
      businessDate,
      soldQuantity,
      variant: { status: variant.status, productStatus: variant.productStatus, sellingQuantityBasis: variant.sellingQuantityBasis },
      links: links.map((link) => ({
        id: link.id,
        kind: link.kind,
        recipeId: link.recipeId,
        itemId: link.itemId,
        quantityMicros: link.quantityMicros,
        unitId: link.unitId,
        effectiveFrom: link.effectiveFrom,
        effectiveTo: link.effectiveTo,
      })),
      recipes: families.map((family) => ({
        id: family.id,
        kind: family.kind,
        status: family.status,
        versions: versions
          .filter((version) => version.recipeId === family.id)
          .map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
            status: version.status,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo,
            yieldQuantityMicros: version.yieldQuantityMicros,
            yieldUnitId: version.yieldUnitId,
            lines: sortedLines.filter((line) => line.recipeVersionId === version.id),
          })),
      })),
      items: items.map((item) => ({ id: item.id, status: item.status, kind: item.kind, storageUnitId: item.storageUnitId })),
      units: units.map(toGraphUnit),
      rules: rules.map((rule) => ({
        id: rule.id,
        itemId: rule.itemId,
        fromUnitId: rule.fromUnitId,
        toUnitId: rule.toUnitId,
        factorMicros: rule.factorMicros,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
      })),
    });

    const unitsById = new Map(units.map((unit) => [unit.id, unit]));
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const linesById = new Map(lines.map((line) => [line.id, line]));
    const names = (await loadVariantRowsInTx(tx, tenantId)).find((row) => row.id === variant.id)!;
    const link = result.linkId ? links.find((row) => row.id === result.linkId) ?? null : null;
    const family = link?.recipeId ? families.find((row) => row.id === link.recipeId) ?? null : null;
    const resolvedVersion = result.status === "resolved" && result.kind === "recipe"
      ? versions.find((version) => version.id === result.versionId) ?? null
      : null;
    const usageLines = result.status === "resolved" ? result.lines : result.detail.line ? [result.detail.line] : [];
    return {
      variantPublicId: variant.publicId,
      productNameEn: names.product.nameEn,
      productNameAr: names.product.nameAr,
      variantNameEn: names.nameEn,
      variantNameAr: names.nameAr,
      businessDate,
      soldQuantity,
      status: result.status,
      kind: result.status === "resolved" ? result.kind : link?.kind ?? null,
      reason: result.status === "unresolved" ? result.reason : null,
      linkPublicId: link?.publicId ?? null,
      recipe: family ? { publicId: family.publicId, nameEn: family.nameEn, nameAr: family.nameAr } : null,
      version: resolvedVersion
        ? {
            publicId: resolvedVersion.publicId,
            versionNumber: resolvedVersion.versionNumber,
            yieldQuantity: microsToDecimalString(resolvedVersion.yieldQuantityMicros!),
            yieldUnitCode: unitsById.get(resolvedVersion.yieldUnitId!)?.code ?? "",
          }
        : null,
      overlappingVersionNumbers: result.status === "unresolved" ? result.detail.versionNumbers ?? [] : [],
      lines: usageLines.map((usage) => {
        const item = itemsById.get(usage.itemId)!;
        const storage = usage.storageUnitId ? unitsById.get(usage.storageUnitId) ?? null : null;
        const places = storage?.decimalPlaces ?? 3;
        return {
          linePublicId: usage.lineId ? linesById.get(usage.lineId)?.publicId ?? null : null,
          item: itemRef(item, unitsById),
          quantity: microsToDecimalString(usage.quantityMicros),
          unitCode: unitsById.get(usage.unitId)?.code ?? "",
          status: usage.status,
          prepared: usage.prepared,
          storageUnitCode: storage?.code ?? null,
          perSale: usage.perSale ? quantityView(usage.perSale, places) : null,
          total: usage.total ? quantityView(usage.total, places) : null,
        };
      }),
      complete: result.status === "resolved" && result.complete,
    };
  });
}
