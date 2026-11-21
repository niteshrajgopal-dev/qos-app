import { updateDraftMenu } from "@/lib/catalogue/menus";
import type { MenuSectionInput } from "@/lib/catalogue/menus.validation";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { menuEditorView, sectionInput } from "@/lib/workbook/apply/handlers/menu-shared";
import { flag, int, lockMenu, present, proposedValues, requireTarget, resolveReference, text } from "@/lib/workbook/apply/handlers/shared";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";

const FIELDS = ["internal_name", "display_name_en", "display_name_ar", "sort_order", "archived"];

/* Menu Sections: updateDraftMenu with the full current section list and the
   new or patched section. `archived` TRUE is the archive, FALSE the restore.
   A new section's id is the one id the saved menu has that it did not have. */
export const applyMenuSections: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const menuPublicId = resolveReference(run, row, "menu_key");
  const menu = await lockMenu(context, menuPublicId);
  await context.guard.enter({ kind: "menu", menuPublicId }, row.operation === "create" ? [] : [row]);
  const view = await menuEditorView(context, menuPublicId);
  const sections = view.sections.map(sectionInput);

  if (row.operation === "create") {
    const created: MenuSectionInput = {
      internalName: text(values, "internal_name") ?? "",
      sortOrder: int(values, "sort_order") ?? Math.max(-1, ...sections.map((section) => section.sortOrder)) + 1,
      archived: flag(values, "archived") ?? false,
      translations: {
        en: { displayName: text(values, "display_name_en") ?? "", description: null },
        ar: { displayName: text(values, "display_name_ar") ?? "", description: null },
      },
      products: [],
    };
    const saved = await updateDraftMenu(context.db, run.tenantId, run.membership, menuPublicId, {
      expectedVersion: menu.version,
      sections: [...sections, created],
    });
    const before = new Set(view.sections.map((section) => section.publicId));
    const added = saved.sections.filter((section) => !before.has(section.publicId));
    if (added.length !== 1) throw new ApplyUnitError("unexpected", "The new section could not be read back.");
    return [{ row, publicId: added[0]!.publicId, created: true, fieldsApplied: present(values, ...FIELDS) }];
  }

  const sectionPublicId = requireTarget(row);
  const target = sections.find((section) => section.publicId === sectionPublicId);
  if (!target) throw new ApplyUnitError("target_not_found", "Menu section not found.");
  if (values.has("internal_name")) target.internalName = text(values, "internal_name") ?? "";
  if (values.has("display_name_en")) target.translations.en = { ...target.translations.en, displayName: text(values, "display_name_en") ?? "" };
  if (values.has("display_name_ar")) target.translations.ar = { ...target.translations.ar, displayName: text(values, "display_name_ar") ?? "" };
  if (values.has("sort_order")) target.sortOrder = int(values, "sort_order") ?? target.sortOrder;
  if (values.has("archived")) target.archived = flag(values, "archived") ?? false;
  await updateDraftMenu(context.db, run.tenantId, run.membership, menuPublicId, { expectedVersion: menu.version, sections });
  return [{ row, publicId: sectionPublicId, fieldsApplied: present(values, ...FIELDS) }];
};
