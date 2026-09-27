import { and, count, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueProducts,
  catalogueMenus,
  catalogueModifierGroups,
  catalogueCategories,
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
    // Count all non-archived products
    const [productsCount] = await tx
      .select({ count: count() })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          inArray(catalogueProducts.status, ["draft", "active"]),
        ),
      );

    // Count all menus
    const [menusCount] = await tx
      .select({ count: count() })
      .from(catalogueMenus)
      .where(eq(catalogueMenus.tenantId, tenantId));

    // Count all non-archived modifier groups
    const [modifierGroupsCount] = await tx
      .select({ count: count() })
      .from(catalogueModifierGroups)
      .where(
        and(
          eq(catalogueModifierGroups.tenantId, tenantId),
          inArray(catalogueModifierGroups.status, ["draft", "active"]),
        ),
      );

    // Count all categories
    const [categoriesCount] = await tx
      .select({ count: count() })
      .from(catalogueCategories)
      .where(eq(catalogueCategories.tenantId, tenantId));

    return {
      products: productsCount?.count ?? 0,
      menus: menusCount?.count ?? 0,
      modifierGroups: modifierGroupsCount?.count ?? 0,
      categories: categoriesCount?.count ?? 0,
    };
  });
}
