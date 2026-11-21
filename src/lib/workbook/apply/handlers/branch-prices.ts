import { and, eq } from "drizzle-orm";

import { catalogueProducts, catalogueVariantLocationPriceOverrides, catalogueVariants } from "@/db/schema";
import { resetProductLocationPriceOverride, setProductLocationPriceOverride } from "@/lib/catalogue/location-price-overrides";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { branchLocation, int, lockProduct, present, proposedValues, requireTarget, resolveReference } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";

async function defaultVariantProduct(context: HandlerContext, variantPublicId: string) {
  const [variant] = await context.tx
    .select({ id: catalogueVariants.id, isDefault: catalogueVariants.isDefault, productPublicId: catalogueProducts.publicId })
    .from(catalogueVariants)
    .innerJoin(catalogueProducts, and(eq(catalogueProducts.tenantId, catalogueVariants.tenantId), eq(catalogueProducts.id, catalogueVariants.productId)))
    .where(and(eq(catalogueVariants.tenantId, context.run.tenantId), eq(catalogueVariants.publicId, variantPublicId)))
    .limit(1);
  if (!variant) throw new ApplyUnitError("target_not_found", "Variant not found.", { field: "variant_key" });
  // The override service resolves the product's default variant only (D-BRANCH-PRICE).
  if (!variant.isDefault) {
    throw new ApplyUnitError("service_validation", "Branch prices can be set for the default variant only.", {
      field: "variant_key",
      reason: "branch_price_default_variant_only",
    });
  }
  return variant;
}

/* Branch Prices: setProductLocationPriceOverride / resetProductLocationPriceOverride
   (administrator only, enforced by the service), for the product's default
   variant and a branch in the plan's scope. */
export const applyBranchPrices: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const variantPublicId = resolveReference(run, row, "variant_key");
  const branchPublicId = resolveReference(run, row, "branch_key");
  const locationId = await branchLocation(context, branchPublicId);
  const variant = await defaultVariantProduct(context, variantPublicId);
  await lockProduct(context, variant.productPublicId);
  if (row.operation !== "create") {
    await context.guard.enter({ kind: "link", sheet: "Branch Prices", id: requireTarget(row) }, [row]);
  }

  if (row.operation === "reset_to_central") {
    await resetProductLocationPriceOverride(context.db, run.tenantId, run.membership, run.actor.subject, variant.productPublicId, branchPublicId);
    return [{ row, publicId: requireTarget(row), fieldsApplied: ["amount_minor"] }];
  }

  const amountMinor = int(values, "amount_minor") ?? (row.after?.amount_minor ? Number(row.after.amount_minor) : null);
  if (amountMinor === null) {
    throw new ApplyUnitError("service_validation", "A branch price needs an amount.", { field: "amount_minor" });
  }
  await setProductLocationPriceOverride(context.db, run.tenantId, run.membership, run.actor.subject, variant.productPublicId, branchPublicId, { amountMinor });
  const [override] = await context.tx
    .select({ id: catalogueVariantLocationPriceOverrides.id })
    .from(catalogueVariantLocationPriceOverrides)
    .where(
      and(
        eq(catalogueVariantLocationPriceOverrides.tenantId, run.tenantId),
        eq(catalogueVariantLocationPriceOverrides.variantId, variant.id),
        eq(catalogueVariantLocationPriceOverrides.locationId, locationId),
      ),
    )
    .limit(1);
  return [{ row, publicId: override?.id ?? requireTarget(row), fieldsApplied: present(values, "amount_minor", "currency") }];
};
