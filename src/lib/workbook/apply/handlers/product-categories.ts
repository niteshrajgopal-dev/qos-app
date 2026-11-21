import { and, eq } from "drizzle-orm";

import { catalogueCategories, catalogueProductCategories } from "@/db/schema";
import { assignProductToCategory, unassignProductFromCategory, updateProductCategoryAssignment } from "@/lib/catalogue/categories";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { int, lockProduct, present, proposedValues, requireTarget, resolveReference } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";

async function linkId(context: HandlerContext, productId: string, categoryPublicId: string) {
  const [link] = await context.tx
    .select({ id: catalogueProductCategories.id })
    .from(catalogueProductCategories)
    .innerJoin(
      catalogueCategories,
      and(eq(catalogueCategories.tenantId, catalogueProductCategories.tenantId), eq(catalogueCategories.id, catalogueProductCategories.categoryId)),
    )
    .where(
      and(
        eq(catalogueProductCategories.tenantId, context.run.tenantId),
        eq(catalogueProductCategories.productId, productId),
        eq(catalogueCategories.publicId, categoryPublicId),
      ),
    )
    .limit(1);
  if (!link) throw new ApplyUnitError("unexpected", "The category assignment could not be read back.");
  return link.id;
}

/* Product Categories: assignProductToCategory (with its sort order),
   updateProductCategoryAssignment and unassignProductFromCategory. A link
   is identified by its two endpoints. */
export const applyProductCategories: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const productPublicId = resolveReference(run, row, "product_key");
  const categoryPublicId = resolveReference(run, row, "category_key");
  const product = await lockProduct(context, productPublicId);

  if (row.operation === "create") {
    await assignProductToCategory(
      context.db,
      run.tenantId,
      categoryPublicId,
      { productPublicId, sortOrder: int(values, "sort_order") ?? undefined },
      run.actor.subject,
      run.membership,
    );
    return [{ row, publicId: await linkId(context, product.id, categoryPublicId), fieldsApplied: present(values, "sort_order") }];
  }

  const target = requireTarget(row);
  await context.guard.enter({ kind: "link", sheet: "Product Categories", id: target }, [row]);
  if (row.operation === "remove_link") {
    await unassignProductFromCategory(context.db, run.tenantId, categoryPublicId, productPublicId, run.actor.subject, run.membership);
    return [{ row, publicId: target, fieldsApplied: [] }];
  }
  const sortOrder = int(values, "sort_order");
  if (sortOrder !== undefined && sortOrder !== null) {
    await updateProductCategoryAssignment(context.db, run.tenantId, categoryPublicId, { productPublicId, sortOrder }, run.actor.subject, run.membership);
  }
  return [{ row, publicId: target, fieldsApplied: present(values, "sort_order") }];
};
