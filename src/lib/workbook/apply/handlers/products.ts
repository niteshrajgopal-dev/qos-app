import {
  archiveDraftProductInTx,
  createDraftProduct,
  restoreArchivedProductInTx,
  updateDraftProductInTx,
} from "@/lib/catalogue/products";
import type { UpdateDraftProductInput } from "@/lib/catalogue/validation";
import { updateProductVariant } from "@/lib/catalogue/variants";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import {
  assertCreateStatus,
  int,
  lockProduct,
  planBrandPublicId,
  present,
  proposedValues,
  requireTarget,
  rowRef,
  text,
  type Values,
} from "@/lib/workbook/apply/handlers/shared";
import type { SavedRow, SheetHandler } from "@/lib/workbook/apply/handlers/types";
import { defaultVariantPatch, VARIANT_FIELDS } from "@/lib/workbook/apply/handlers/variants";

const FIELDS = ["internal_name", "display_name_en", "display_name_ar", "description_en", "description_ar", "sku", "barcode", "nutrition_calories", "status"];

function productTranslations(values: Values) {
  const translations: NonNullable<UpdateDraftProductInput["translations"]> = {};
  for (const locale of ["en", "ar"] as const) {
    const name = `display_name_${locale}`;
    const description = `description_${locale}`;
    if (!values.has(name) && !values.has(description)) continue;
    translations[locale] = {
      ...(values.has(name) ? { displayName: text(values, name) ?? "" } : {}),
      ...(values.has(description) ? { description: text(values, description) ?? null } : {}),
    };
  }
  return translations;
}

function imageOf(values: Values) {
  const url = text(values, "image_url");
  return url ? { imageUrl: url } : {};
}

/* Products: createDraftProduct (draft, with its default variant and price
   from the grouped default Variants row) / updateDraftProductInTx, and the
   archive and restore services. Product status otherwise changes only by
   publication (D-STATUS-FIELD). Description, SKU, barcode and calories are
   always passed, never dropped. */
export const applyProducts: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);

  if (row.operation === "create") {
    assertCreateStatus(values, ["draft"]);
    const variantRow = unit.rows[1];
    if (!variantRow) {
      throw new ApplyUnitError("dependency_unresolved", "A new product needs its default Variants row.", { field: "product_key" });
    }
    const variant = proposedValues(variantRow);
    const amountMinor = int(variant, "amount_minor");
    if (amountMinor === undefined || amountMinor === null) {
      throw new ApplyUnitError("service_validation", "The default variant needs a price.", { field: "amount_minor", responsible: rowRef(variantRow) });
    }
    const product = await createDraftProduct(context.db, run.tenantId, run.membership, {
      internalName: text(values, "internal_name") ?? "",
      brandPublicId: await planBrandPublicId(context),
      sku: text(values, "sku") ?? null,
      barcode: text(values, "barcode") ?? null,
      nutritionCalories: int(values, "nutrition_calories") ?? null,
      provenance: "imported",
      translations: {
        en: { displayName: text(values, "display_name_en") ?? "", description: text(values, "description_en") ?? null },
        ar: { displayName: text(values, "display_name_ar") ?? "", description: text(values, "description_ar") ?? null },
      },
      defaultVariant: { amountMinor, currency: text(variant, "currency") ?? undefined },
    });
    const patch = defaultVariantPatch(variant);
    if (Object.keys(patch).length > 0) {
      await updateProductVariant(
        context.db,
        run.tenantId,
        run.membership,
        product.publicId,
        product.defaultVariant.publicId,
        { expectedProductVersion: product.version, ...patch },
        run.actor.subject,
      );
    }
    return [
      { row, publicId: product.publicId, created: true, fieldsApplied: present(values, ...FIELDS), ...imageOf(values) },
      { row: variantRow, publicId: product.defaultVariant.publicId, created: true, fieldsApplied: present(variant, ...VARIANT_FIELDS) },
    ];
  }

  const publicId = requireTarget(row);
  await lockProduct(context, publicId);
  await context.guard.enter({ kind: "record", sheet: "Products", publicId }, [row]);

  const status = text(values, "status");
  const before = row.before?.status;
  const restoring = status === "draft" && before === "archived";
  if (status === "active" && before !== "active") {
    throw new ApplyUnitError("service_validation", "Only publication activates a product.", { field: "status", reason: "status_requires_publication" });
  }
  if (restoring) {
    await restoreArchivedProductInTx(context.tx, run.tenantId, publicId, run.actor.subject);
  }

  const translations = productTranslations(values);
  const input: Omit<UpdateDraftProductInput, "expectedVersion"> = {
    ...(values.has("internal_name") ? { internalName: text(values, "internal_name") ?? "" } : {}),
    ...(values.has("sku") ? { sku: text(values, "sku") ?? null } : {}),
    ...(values.has("barcode") ? { barcode: text(values, "barcode") ?? null } : {}),
    ...(values.has("nutrition_calories") ? { nutritionCalories: int(values, "nutrition_calories") ?? null } : {}),
    // A cleared image detaches the current one; a new URL is fetched after the unit commits.
    ...(values.has("image_url") && text(values, "image_url") === null ? { primaryMediaAssetId: null } : {}),
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
  };
  if (Object.keys(input).length > 0) {
    const current = await lockProduct(context, publicId);
    await updateDraftProductInTx(context.tx, run.tenantId, run.membership, publicId, { expectedVersion: current.version, ...input }, run.actor.subject);
  }
  if (status === "archived") {
    await archiveDraftProductInTx(context.tx, run.tenantId, publicId, run.actor.subject);
  }
  const saved: SavedRow = {
    row,
    publicId,
    fieldsApplied: [...present(values, ...FIELDS), ...(values.has("image_url") && text(values, "image_url") === null ? ["image_url"] : [])],
    ...imageOf(values),
  };
  return [saved];
};
