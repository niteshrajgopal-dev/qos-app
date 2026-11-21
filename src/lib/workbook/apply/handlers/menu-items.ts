import { and, eq } from "drizzle-orm";

import { catalogueMenuSectionProducts, catalogueMenuSections, catalogueProducts } from "@/db/schema";
import { updateDraftMenu } from "@/lib/catalogue/menus";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { menuEditorView, menuOfSection, sectionInput } from "@/lib/workbook/apply/handlers/menu-shared";
import { flag, int, lockMenu, lockProduct, present, proposedValues, requireTarget, resolveReference } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";

async function placementId(context: HandlerContext, sectionPublicId: string, productPublicId: string) {
  const [placement] = await context.tx
    .select({ id: catalogueMenuSectionProducts.id })
    .from(catalogueMenuSectionProducts)
    .innerJoin(
      catalogueMenuSections,
      and(eq(catalogueMenuSections.tenantId, catalogueMenuSectionProducts.tenantId), eq(catalogueMenuSections.id, catalogueMenuSectionProducts.sectionId)),
    )
    .innerJoin(
      catalogueProducts,
      and(eq(catalogueProducts.tenantId, catalogueMenuSectionProducts.tenantId), eq(catalogueProducts.id, catalogueMenuSectionProducts.productId)),
    )
    .where(
      and(
        eq(catalogueMenuSectionProducts.tenantId, context.run.tenantId),
        eq(catalogueMenuSections.publicId, sectionPublicId),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);
  if (!placement) throw new ApplyUnitError("unexpected", "The menu item could not be read back.");
  return placement.id;
}

/* Menu Items: updateDraftMenu with the full current section list, the product
   placed in (or patched within) its section. `archived` TRUE is the archive;
   there is no remove_link for items. */
export const applyMenuItems: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const sectionPublicId = resolveReference(run, row, "section_key");
  const productPublicId = resolveReference(run, row, "product_key");
  await lockProduct(context, productPublicId);
  const menuPublicId = await menuOfSection(context, sectionPublicId);
  const menu = await lockMenu(context, menuPublicId);
  await context.guard.enter({ kind: "menu", menuPublicId }, row.operation === "create" ? [] : [row]);
  const view = await menuEditorView(context, menuPublicId);
  const sections = view.sections.map(sectionInput);
  const section = sections.find((entry) => entry.publicId === sectionPublicId);
  if (!section) throw new ApplyUnitError("target_not_found", "Menu section not found.", { field: "section_key" });
  const existing = section.products.find((entry) => entry.productPublicId === productPublicId);

  if (row.operation === "create") {
    const placement = {
      productPublicId,
      sortOrder: int(values, "sort_order") ?? Math.max(-1, ...section.products.map((entry) => entry.sortOrder)) + 1,
      archived: flag(values, "archived") ?? false,
    };
    if (existing) Object.assign(existing, placement);
    else section.products.push(placement);
  } else {
    requireTarget(row);
    if (!existing) throw new ApplyUnitError("target_not_found", "Menu item not found.");
    if (values.has("sort_order")) existing.sortOrder = int(values, "sort_order") ?? existing.sortOrder;
    if (values.has("archived")) existing.archived = flag(values, "archived") ?? false;
  }
  await updateDraftMenu(context.db, run.tenantId, run.membership, menuPublicId, { expectedVersion: menu.version, sections });
  return [{ row, publicId: await placementId(context, sectionPublicId, productPublicId), fieldsApplied: present(values, "sort_order", "archived") }];
};
