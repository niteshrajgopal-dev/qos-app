import { and, eq } from "drizzle-orm";

import { catalogueModifierGroups, catalogueModifierOptions } from "@/db/schema";
import { createModifierOption, updateModifierOption } from "@/lib/catalogue/modifiers";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import {
  assertCreateStatus,
  flag,
  int,
  nameTranslations,
  notClearable,
  present,
  proposedValues,
  requireTarget,
  resolveReference,
  text,
} from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";

const FIELDS = ["display_name_en", "display_name_ar", "price_minor", "currency", "is_default", "allows_quantity", "max_quantity", "sort_order", "status"];

async function lockGroup(context: HandlerContext, publicId: string) {
  const [group] = await context.tx
    .select({ id: catalogueModifierGroups.id, version: catalogueModifierGroups.version })
    .from(catalogueModifierGroups)
    .where(and(eq(catalogueModifierGroups.tenantId, context.run.tenantId), eq(catalogueModifierGroups.publicId, publicId)))
    .limit(1)
    .for("update");
  if (!group) throw new ApplyUnitError("target_not_found", "Modifier group not found.", { field: "modifier_group_key" });
  return group;
}

/* Modifier Options: createModifierOption / updateModifierOption (option
   prices need an administrator; the service enforces it). allow_repeat and
   aggregator prices stay deferred (QOS-212–215). */
export const applyModifierOptions: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const groupPublicId = resolveReference(run, row, "modifier_group_key");
  const group = await lockGroup(context, groupPublicId);

  if (row.operation === "create") {
    assertCreateStatus(values, ["active"]);
    await context.guard.enter({ kind: "group", groupPublicId }, []);
    const existing = await context.tx
      .select({ publicId: catalogueModifierOptions.publicId })
      .from(catalogueModifierOptions)
      .where(and(eq(catalogueModifierOptions.tenantId, run.tenantId), eq(catalogueModifierOptions.modifierGroupId, group.id)));
    const before = new Set(existing.map((option) => option.publicId));
    const view = await createModifierOption(
      context.db,
      run.tenantId,
      groupPublicId,
      {
        expectedGroupVersion: group.version,
        sortOrder: int(values, "sort_order") ?? undefined,
        isDefault: flag(values, "is_default"),
        allowsQuantity: flag(values, "allows_quantity"),
        maxQuantity: int(values, "max_quantity") ?? undefined,
        priceMinor: int(values, "price_minor") ?? undefined,
        currency: text(values, "currency") ?? undefined,
        translations: nameTranslations(values),
      },
      run.actor.subject,
      run.membership,
    );
    const created = view.options.filter((option) => !before.has(option.publicId));
    if (created.length !== 1) throw new ApplyUnitError("unexpected", "The new option could not be read back.");
    return [{ row, publicId: created[0]!.publicId, created: true, fieldsApplied: present(values, ...FIELDS) }];
  }

  const optionPublicId = requireTarget(row);
  await context.guard.enter({ kind: "group", groupPublicId }, [row]);
  notClearable(values, "max_quantity");
  notClearable(values, "price_minor");
  const status = text(values, "status");
  const translations = nameTranslations(values);
  await updateModifierOption(
    context.db,
    run.tenantId,
    groupPublicId,
    optionPublicId,
    {
      expectedGroupVersion: group.version,
      ...(values.has("sort_order") ? { sortOrder: int(values, "sort_order") ?? undefined } : {}),
      ...(values.has("is_default") ? { isDefault: flag(values, "is_default") } : {}),
      ...(values.has("allows_quantity") ? { allowsQuantity: flag(values, "allows_quantity") } : {}),
      ...(values.has("max_quantity") ? { maxQuantity: int(values, "max_quantity") ?? undefined } : {}),
      ...(values.has("price_minor") ? { priceMinor: int(values, "price_minor") ?? undefined } : {}),
      ...(status === "active" || status === "archived" ? { status } : {}),
      ...(Object.keys(translations).length > 0 ? { translations } : {}),
    },
    run.actor.subject,
    run.membership,
  );
  return [{ row, publicId: optionPublicId, fieldsApplied: present(values, ...FIELDS) }];
};
