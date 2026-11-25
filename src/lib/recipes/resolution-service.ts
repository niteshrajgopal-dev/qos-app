import type { DbClient } from "@/db/client";
import { type ConfigurationPreviewView, getConfigurationPreview } from "@/lib/recipes/costing-service";
import type { LineUsageStatus, UnresolvedReason } from "@/lib/recipes/resolution";
import type { DecimalView, ItemRef } from "@/lib/recipes/views";

/* QOS-198 consumption preview: what one sale (or `soldQuantity` sales) of a
   variant uses on a business date, from the pure resolver (resolution.ts).
   QOS-199 computes it in costing-service.ts together with modifier effects,
   cost and margin. Read-only: it never writes, posts or moves stock. Any
   active member may read it. */

export { MAX_PREVIEW_QUANTITY } from "@/lib/recipes/costing-service";

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

/**
 * The QOS-198 entry point, kept for existing callers: the base usage with no
 * options requested. QOS-199's getConfigurationPreview builds the same fields
 * plus selections, effects, cost and margin.
 */
export async function getConsumptionPreview(
  db: DbClient,
  tenantId: string,
  query: { variantPublicId: string | null; date: string | null; quantity: string | null },
  now: Date = new Date(),
): Promise<ConfigurationPreviewView> {
  return getConfigurationPreview(db, tenantId, query, now);
}
