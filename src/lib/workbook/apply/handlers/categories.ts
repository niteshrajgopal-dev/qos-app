import { and, eq } from "drizzle-orm";

import { catalogueCategories } from "@/db/schema";
import { createCategory, updateCategory } from "@/lib/catalogue/categories";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { assertCreateStatus, int, nameTranslations, present, proposedValues, requireTarget, text } from "@/lib/workbook/apply/handlers/shared";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";

/* Categories (tenant-wide): createCategory / updateCategory. Archive and
   restore are the status field of the same update service. */
export const applyCategories: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);

  if (row.operation === "create") {
    assertCreateStatus(values, ["active"]);
    const view = await createCategory(
      context.db,
      run.tenantId,
      {
        internalName: text(values, "internal_name") ?? "",
        sortOrder: int(values, "sort_order") ?? undefined,
        translations: { en: { displayName: text(values, "display_name_en") ?? "" }, ar: { displayName: text(values, "display_name_ar") ?? "" } },
      },
      run.actor.subject,
      run.membership,
    );
    return [{ row, publicId: view.publicId, created: true, fieldsApplied: present(values, "internal_name", "sort_order", "display_name_en", "display_name_ar", "status") }];
  }

  const publicId = requireTarget(row);
  await context.guard.enter({ kind: "record", sheet: "Categories", publicId }, [row]);
  const [category] = await context.tx
    .select({ version: catalogueCategories.version })
    .from(catalogueCategories)
    .where(and(eq(catalogueCategories.tenantId, run.tenantId), eq(catalogueCategories.publicId, publicId)))
    .limit(1);
  if (!category) throw new ApplyUnitError("target_not_found", "Category not found.");
  const status = text(values, "status");
  const translations = nameTranslations(values);
  await updateCategory(
    context.db,
    run.tenantId,
    publicId,
    {
      expectedVersion: category.version,
      ...(values.has("internal_name") ? { internalName: text(values, "internal_name") ?? "" } : {}),
      ...(values.has("sort_order") ? { sortOrder: int(values, "sort_order") ?? undefined } : {}),
      ...(status === "active" || status === "archived" ? { status } : {}),
      ...(Object.keys(translations).length > 0 ? { translations } : {}),
    },
    run.actor.subject,
    run.membership,
  );
  return [{ row, publicId, fieldsApplied: present(values, "internal_name", "sort_order", "display_name_en", "display_name_ar", "status") }];
};
