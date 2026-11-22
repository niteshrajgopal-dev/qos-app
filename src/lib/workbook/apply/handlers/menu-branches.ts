import { updateDraftMenu } from "@/lib/catalogue/menus";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { menuLocationIds } from "@/lib/workbook/apply/handlers/menu-shared";
import { branchLocation, lockMenu, requireTarget, resolveReference } from "@/lib/workbook/apply/handlers/shared";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";

/* Menu Branches: updateDraftMenu with the menu's current locations plus or
   minus this branch. Locations outside the plan's scope are kept as they
   are. A new menu's branches are saved with the menu itself. */
export const applyMenuBranches: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const menuPublicId = resolveReference(run, row, "menu_key");
  const branchPublicId = resolveReference(run, row, "branch_key");
  const locationId = await branchLocation(context, branchPublicId);
  const menu = await lockMenu(context, menuPublicId);
  await context.guard.enter({ kind: "menu", menuPublicId }, row.operation === "create" ? [] : [row]);
  const current = (await menuLocationIds(context, menu.id)).map((entry) => entry.locationId);

  if (row.operation === "create") {
    await updateDraftMenu(context.db, run.tenantId, run.membership, menuPublicId, {
      expectedVersion: menu.version,
      locationIds: [...new Set([...current, locationId])],
    });
    const link = (await menuLocationIds(context, menu.id)).find((entry) => entry.locationId === locationId);
    if (!link) throw new ApplyUnitError("unexpected", "The menu branch could not be read back.");
    return [{ row, publicId: link.id, fieldsApplied: [] }];
  }
  if (row.operation === "remove_link") {
    await updateDraftMenu(context.db, run.tenantId, run.membership, menuPublicId, {
      expectedVersion: menu.version,
      locationIds: current.filter((id) => id !== locationId),
    });
    return [{ row, publicId: requireTarget(row), fieldsApplied: [] }];
  }
  throw new ApplyUnitError("unsupported_field", "A menu branch has no values to update.");
};
