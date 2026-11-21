import { and, eq } from "drizzle-orm";

import { catalogueModifierGroups } from "@/db/schema";
import { createModifierGroup, updateModifierGroup } from "@/lib/catalogue/modifiers";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { assertCreateStatus, int, nameTranslations, present, proposedValues, requireTarget, text } from "@/lib/workbook/apply/handlers/shared";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";

const FIELDS = ["internal_name", "display_name_en", "display_name_ar", "min_selections", "max_selections", "status"];

/* Modifier Groups (tenant-wide): createModifierGroup / updateModifierGroup.
   Assignment min 0/1 stays optional or mandatory as settled in #93. */
export const applyModifierGroups: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);

  if (row.operation === "create") {
    assertCreateStatus(values, ["active"]);
    const view = await createModifierGroup(
      context.db,
      run.tenantId,
      {
        internalName: text(values, "internal_name") ?? "",
        minSelections: int(values, "min_selections") ?? undefined,
        maxSelections: int(values, "max_selections") ?? undefined,
        translations: { en: { displayName: text(values, "display_name_en") ?? "" }, ar: { displayName: text(values, "display_name_ar") ?? "" } },
      },
      run.actor.subject,
      run.membership,
    );
    return [{ row, publicId: view.publicId, created: true, fieldsApplied: present(values, ...FIELDS) }];
  }

  const publicId = requireTarget(row);
  await context.guard.enter({ kind: "record", sheet: "Modifier Groups", publicId }, [row]);
  const [group] = await context.tx
    .select({ version: catalogueModifierGroups.version })
    .from(catalogueModifierGroups)
    .where(and(eq(catalogueModifierGroups.tenantId, run.tenantId), eq(catalogueModifierGroups.publicId, publicId)))
    .limit(1);
  if (!group) throw new ApplyUnitError("target_not_found", "Modifier group not found.");
  const status = text(values, "status");
  const translations = nameTranslations(values);
  await updateModifierGroup(
    context.db,
    run.tenantId,
    publicId,
    {
      expectedVersion: group.version,
      ...(values.has("internal_name") ? { internalName: text(values, "internal_name") ?? "" } : {}),
      ...(values.has("min_selections") ? { minSelections: int(values, "min_selections") ?? undefined } : {}),
      ...(values.has("max_selections") ? { maxSelections: int(values, "max_selections") ?? undefined } : {}),
      ...(status === "active" || status === "archived" ? { status } : {}),
      ...(Object.keys(translations).length > 0 ? { translations } : {}),
    },
    run.actor.subject,
    run.membership,
  );
  return [{ row, publicId, fieldsApplied: present(values, ...FIELDS) }];
};
