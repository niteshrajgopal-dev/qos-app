import { and, eq } from "drizzle-orm";

import { catalogueMenuLocations, catalogueMenus, catalogueMenuSections } from "@/db/schema";
import { loadDraftMenuEditorView, type MenuSectionView } from "@/lib/catalogue/menus";
import type { MenuSectionInput } from "@/lib/catalogue/menus.validation";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import type { HandlerContext } from "@/lib/workbook/apply/handlers/types";

/* Menu helpers. `updateDraftMenu` replaces the whole section list (sections
   that are not sent are deleted), so a section or item change always sends
   every current section with only the targeted one patched. */

export function sectionInput(section: MenuSectionView): MenuSectionInput {
  return {
    publicId: section.publicId,
    internalName: section.internalName,
    sortOrder: section.sortOrder,
    archived: section.archived,
    translations: {
      en: { displayName: section.translations.en.displayName, description: section.translations.en.description },
      ar: { displayName: section.translations.ar.displayName, description: section.translations.ar.description },
    },
    products: section.products.map((product) => ({ productPublicId: product.productPublicId, sortOrder: product.sortOrder, archived: product.archived })),
  };
}

export async function menuEditorView(context: HandlerContext, menuPublicId: string) {
  const view = await loadDraftMenuEditorView(context.db, context.run.tenantId, menuPublicId);
  if (!view) throw new ApplyUnitError("target_not_found", "Menu not found.");
  return view;
}

/** The menu a section belongs to. */
export async function menuOfSection(context: HandlerContext, sectionPublicId: string) {
  const [section] = await context.tx
    .select({ menuPublicId: catalogueMenus.publicId })
    .from(catalogueMenuSections)
    .innerJoin(catalogueMenus, and(eq(catalogueMenus.tenantId, catalogueMenuSections.tenantId), eq(catalogueMenus.id, catalogueMenuSections.menuId)))
    .where(and(eq(catalogueMenuSections.tenantId, context.run.tenantId), eq(catalogueMenuSections.publicId, sectionPublicId)))
    .limit(1);
  if (!section) throw new ApplyUnitError("target_not_found", "Menu section not found.", { field: "section_key" });
  return section.menuPublicId;
}

/** Internal location ids a menu is offered at now (all of them, also outside the plan's scope). */
export async function menuLocationIds(context: HandlerContext, menuId: string) {
  const rows = await context.tx
    .select({ id: catalogueMenuLocations.id, locationId: catalogueMenuLocations.locationId })
    .from(catalogueMenuLocations)
    .where(and(eq(catalogueMenuLocations.tenantId, context.run.tenantId), eq(catalogueMenuLocations.menuId, menuId)));
  return rows;
}
