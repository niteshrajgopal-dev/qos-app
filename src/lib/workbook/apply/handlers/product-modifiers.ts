import { and, asc, eq } from "drizzle-orm";

import { catalogueModifierGroups, catalogueProductModifierGroups } from "@/db/schema";
import { attachModifierGroupToProduct, detachModifierGroupFromProduct, reorderProductModifierGroups } from "@/lib/catalogue/modifiers";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { int, lockProduct, present, proposedValues, requireTarget, resolveReference } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";

async function assignments(context: HandlerContext, productId: string) {
  return context.tx
    .select({ id: catalogueProductModifierGroups.id, groupPublicId: catalogueModifierGroups.publicId, sortOrder: catalogueProductModifierGroups.sortOrder })
    .from(catalogueProductModifierGroups)
    .innerJoin(
      catalogueModifierGroups,
      and(eq(catalogueModifierGroups.tenantId, catalogueProductModifierGroups.tenantId), eq(catalogueModifierGroups.id, catalogueProductModifierGroups.modifierGroupId)),
    )
    .where(and(eq(catalogueProductModifierGroups.tenantId, context.run.tenantId), eq(catalogueProductModifierGroups.productId, productId)))
    .orderBy(asc(catalogueProductModifierGroups.sortOrder), asc(catalogueModifierGroups.publicId));
}

/* Product Modifiers: attachModifierGroupToProduct (with its sort order),
   reorderProductModifierGroups for a new position (the service stores the
   resulting order as 0..n-1) and detachModifierGroupFromProduct.
   `free_options_count` stays deferred (QOS-212). */
export const applyProductModifiers: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const productPublicId = resolveReference(run, row, "product_key");
  const groupPublicId = resolveReference(run, row, "modifier_group_key");
  const product = await lockProduct(context, productPublicId);
  await context.guard.enter({ kind: "product", productPublicId }, row.operation === "create" ? [] : [row]);

  if (row.operation === "create") {
    await attachModifierGroupToProduct(
      context.db,
      run.tenantId,
      productPublicId,
      { expectedProductVersion: product.version, modifierGroupPublicId: groupPublicId, sortOrder: int(values, "sort_order") ?? undefined },
      run.actor.subject,
      run.membership,
    );
    const link = (await assignments(context, product.id)).find((entry) => entry.groupPublicId === groupPublicId);
    if (!link) throw new ApplyUnitError("unexpected", "The modifier assignment could not be read back.");
    return [{ row, publicId: link.id, fieldsApplied: present(values, "sort_order") }];
  }

  const target = requireTarget(row);
  if (row.operation === "remove_link") {
    await detachModifierGroupFromProduct(context.db, run.tenantId, productPublicId, groupPublicId, product.version, run.actor.subject, run.membership);
    return [{ row, publicId: target, fieldsApplied: [] }];
  }
  const sortOrder = int(values, "sort_order");
  if (sortOrder !== undefined && sortOrder !== null) {
    const current = await assignments(context, product.id);
    const orderedPublicIds = current
      .map((entry, index) => ({ ...entry, index, sort: entry.groupPublicId === groupPublicId ? sortOrder : entry.sortOrder, moved: entry.groupPublicId === groupPublicId }))
      .sort((a, b) => a.sort - b.sort || Number(b.moved) - Number(a.moved) || a.index - b.index)
      .map((entry) => entry.groupPublicId);
    await reorderProductModifierGroups(
      context.db,
      run.tenantId,
      productPublicId,
      { expectedProductVersion: product.version, orderedPublicIds },
      run.actor.subject,
      run.membership,
    );
  }
  return [{ row, publicId: target, fieldsApplied: present(values, "sort_order") }];
};
