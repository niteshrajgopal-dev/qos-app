import { and, eq } from "drizzle-orm";

import { catalogueVariants } from "@/db/schema";
import { createProductVariant, restoreArchivedVariant, updateProductVariant } from "@/lib/catalogue/variants";
import type { UpdateProductVariantInput } from "@/lib/catalogue/variant-validation";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import {
  assertCreateStatus,
  flag,
  int,
  lockProduct,
  nameTranslations,
  notClearable,
  present,
  proposedValues,
  requireTarget,
  resolveReference,
  text,
  type Values,
} from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";

export const VARIANT_FIELDS = ["variant_label_en", "variant_label_ar", "is_default", "sort_order", "sku", "barcode", "amount_minor", "currency", "status"];

/** Labels, identifiers and order of a product's generated default variant (its price is set by the product create). */
export function defaultVariantPatch(values: Values): Omit<UpdateProductVariantInput, "expectedProductVersion"> {
  assertCreateStatus(values, ["active"]);
  const translations = nameTranslations(values, "variant_label_en", "variant_label_ar");
  return {
    ...(values.has("sort_order") ? { sortOrder: int(values, "sort_order") ?? undefined } : {}),
    ...(values.has("sku") ? { sku: text(values, "sku") ?? null } : {}),
    ...(values.has("barcode") ? { barcode: text(values, "barcode") ?? null } : {}),
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
  };
}

async function variantIdsOf(context: HandlerContext, productId: string) {
  const rows = await context.tx
    .select({ publicId: catalogueVariants.publicId, isDefault: catalogueVariants.isDefault, status: catalogueVariants.status })
    .from(catalogueVariants)
    .where(and(eq(catalogueVariants.tenantId, context.run.tenantId), eq(catalogueVariants.productId, productId)));
  return rows;
}

/* Variants: createProductVariant / updateProductVariant (price changes need
   an administrator; the service enforces it). One default per product: the
   row that makes a variant the default moves the flag, so a row that only
   clears its own flag sends nothing for it. The default variant is never
   archived. An archived variant set back to active goes through the restore
   service (non-default, audited as a restore) before any other field. */
export const applyVariants: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);

  if (row.operation === "create") {
    assertCreateStatus(values, ["active"]);
    const productPublicId = resolveReference(run, row, "product_key");
    const product = await lockProduct(context, productPublicId);
    await context.guard.enter({ kind: "product", productPublicId }, []);
    const before = new Set((await variantIdsOf(context, product.id)).map((variant) => variant.publicId));
    const view = await createProductVariant(
      context.db,
      run.tenantId,
      run.membership,
      productPublicId,
      {
        expectedProductVersion: product.version,
        sortOrder: int(values, "sort_order") ?? undefined,
        isDefault: flag(values, "is_default"),
        sku: text(values, "sku") ?? null,
        barcode: text(values, "barcode") ?? null,
        amountMinor: int(values, "amount_minor") ?? null,
        currency: text(values, "currency") ?? undefined,
        translations: nameTranslations(values, "variant_label_en", "variant_label_ar"),
      },
      run.actor.subject,
    );
    const created = view.variants.find((variant) => !before.has(variant.publicId));
    if (!created) throw new ApplyUnitError("unexpected", "The new variant could not be read back.");
    return [{ row, publicId: created.publicId, created: true, fieldsApplied: present(values, ...VARIANT_FIELDS) }];
  }

  const variantPublicId = requireTarget(row);
  const productPublicId = resolveReference(run, row, "product_key");
  const product = await lockProduct(context, productPublicId);
  await context.guard.enter({ kind: "product", productPublicId }, [row]);
  const current = (await variantIdsOf(context, product.id)).find((variant) => variant.publicId === variantPublicId);
  if (!current) throw new ApplyUnitError("target_not_found", "Variant not found.");
  const status = text(values, "status");
  if (status === "archived" && current.isDefault) {
    throw new ApplyUnitError("service_validation", "The default variant cannot be archived.", { field: "status", reason: "default_variant_archive" });
  }
  notClearable(values, "amount_minor");
  const isDefault = flag(values, "is_default");
  const translations = nameTranslations(values, "variant_label_en", "variant_label_ar");
  const restoring = status === "active" && current.status === "archived";
  let expectedProductVersion = product.version;
  if (restoring) {
    const restored = await restoreArchivedVariant(
      context.db,
      run.tenantId,
      run.membership,
      productPublicId,
      variantPublicId,
      { expectedProductVersion },
      run.actor.subject,
    );
    expectedProductVersion = restored.productVersion;
  }
  const nextStatus = status === "archived" ? "archived" : status === "active" && !restoring ? "active" : undefined;
  const patch: Omit<UpdateProductVariantInput, "expectedProductVersion"> = {
    ...(values.has("sort_order") ? { sortOrder: int(values, "sort_order") ?? undefined } : {}),
    ...(isDefault === true ? { isDefault: true } : {}),
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(values.has("sku") ? { sku: text(values, "sku") ?? null } : {}),
    ...(values.has("barcode") ? { barcode: text(values, "barcode") ?? null } : {}),
    ...(values.has("amount_minor") ? { amountMinor: int(values, "amount_minor") ?? null } : {}),
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
  };
  if (!restoring || Object.keys(patch).length > 0) {
    await updateProductVariant(
      context.db,
      run.tenantId,
      run.membership,
      productPublicId,
      variantPublicId,
      { expectedProductVersion, ...patch },
      run.actor.subject,
    );
  }
  const fields = present(values, ...VARIANT_FIELDS).filter((column) => column !== "is_default" || isDefault === true);
  return [{ row, publicId: variantPublicId, fieldsApplied: fields }];
};
