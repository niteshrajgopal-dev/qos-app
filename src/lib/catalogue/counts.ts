import { count, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueCategories,
  catalogueMenus,
  catalogueModifierGroups,
  catalogueProducts,
} from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";

export type CatalogueCounts = {
  products: number;
  menus: number;
  modifierGroups: number;
  categories: number;
};

export async function getCatalogueCounts(
  db: DbClient,
  tenantId: string,
): Promise<CatalogueCounts> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [productResult] = await tx
      .select({ count: count() })
      .from(catalogueProducts)
      .where(eq(catalogueProducts.tenantId, tenantId));

    const [menuResult] = await tx
      .select({ count: count() })
      .from(catalogueMenus)
      .where(eq(catalogueMenus.tenantId, tenantId));

    const [modifierGroupResult] = await tx
      .select({ count: count() })
      .from(catalogueModifierGroups)
      .where(eq(catalogueModifierGroups.tenantId, tenantId));

    const [categoryResult] = await tx
      .select({ count: count() })
      .from(catalogueCategories)
      .where(eq(catalogueCategories.tenantId, tenantId));

    return {
      products: productResult?.count ? Number(productResult.count) : 0,
      menus: menuResult?.count ? Number(menuResult.count) : 0,
      modifierGroups: modifierGroupResult?.count
        ? Number(modifierGroupResult.count)
        : 0,
      categories: categoryResult?.count ? Number(categoryResult.count) : 0,
    };
  });
}
