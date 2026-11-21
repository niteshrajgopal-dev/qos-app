import { createDraftMenu, updateDraftMenu } from "@/lib/catalogue/menus";
import type { UpdateDraftMenuInput } from "@/lib/catalogue/menus.validation";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { menuLocationIds } from "@/lib/workbook/apply/handlers/menu-shared";
import {
  assertCreateStatus,
  branchLocation,
  lockMenu,
  planBrandPublicId,
  present,
  proposedValues,
  requireTarget,
  resolveReference,
  text,
  type Values,
} from "@/lib/workbook/apply/handlers/shared";
import type { SavedRow, SheetHandler } from "@/lib/workbook/apply/handlers/types";

const FIELDS = ["internal_name", "display_name_en", "display_name_ar", "description_en", "description_ar", "status"];

function menuTranslations(values: Values) {
  const translations: NonNullable<UpdateDraftMenuInput["translations"]> = {};
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

/* Menus: createDraftMenu (a draft, at the branches of the Menu Branches
   rows created with it, because a menu needs at least one location) /
   updateDraftMenu. No service archives a menu or changes its status
   (D-MENU-ARCHIVE, D-STATUS-FIELD); nothing here publishes. */
export const applyMenus: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);

  if (row.operation === "create") {
    assertCreateStatus(values, ["draft"]);
    const branchRows = unit.rows.slice(1);
    if (branchRows.length === 0) {
      throw new ApplyUnitError("service_validation", "A new menu needs at least one Menu Branches row.", { field: "menu_key", reason: "menu_requires_branch" });
    }
    const locationIds: string[] = [];
    for (const branchRow of branchRows) {
      locationIds.push(await branchLocation(context, resolveReference(run, branchRow, "branch_key")));
    }
    const menu = await createDraftMenu(context.db, run.tenantId, run.membership, {
      internalName: text(values, "internal_name") ?? "",
      brandPublicId: await planBrandPublicId(context),
      locationIds,
      translations: {
        en: { displayName: text(values, "display_name_en") ?? "", description: text(values, "description_en") ?? null },
        ar: { displayName: text(values, "display_name_ar") ?? "", description: text(values, "description_ar") ?? null },
      },
    });
    const locked = await lockMenu(context, menu.publicId);
    const links = await menuLocationIds(context, locked.id);
    const saved: SavedRow[] = [{ row, publicId: menu.publicId, created: true, fieldsApplied: present(values, ...FIELDS) }];
    branchRows.forEach((branchRow, index) => {
      const link = links.find((entry) => entry.locationId === locationIds[index]);
      if (!link) throw new ApplyUnitError("unexpected", "The menu branch could not be read back.");
      saved.push({ row: branchRow, publicId: link.id, fieldsApplied: [] });
    });
    return saved;
  }

  const publicId = requireTarget(row);
  const menu = await lockMenu(context, publicId);
  await context.guard.enter({ kind: "record", sheet: "Menus", publicId }, [row]);
  const status = text(values, "status");
  if (status === "active") {
    throw new ApplyUnitError("service_validation", "No service changes a menu's status; publish from the menu editor.", {
      field: "status",
      reason: "status_requires_publication",
    });
  }
  const translations = menuTranslations(values);
  await updateDraftMenu(context.db, run.tenantId, run.membership, publicId, {
    expectedVersion: menu.version,
    ...(values.has("internal_name") ? { internalName: text(values, "internal_name") ?? "" } : {}),
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
  });
  return [{ row, publicId, fieldsApplied: present(values, ...FIELDS) }];
};
