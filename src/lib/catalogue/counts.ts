import { and, count, eq } from "drizzle-orm";

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
    const [productsCount] = await tx
      .select({ count: count() })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.status, "active"),
        ),
      );

    const [menusCount] = await tx
      .select({ count: count() })
      .from(catalogueMenus)
      .where(eq(catalogueMenus.tenantId, tenantId));

    const [modifierGroupsCount] = await tx
      .select({ count: count() })
      .from(catalogueModifierGroups)
      .where(
        and(
          eq(catalogueModifierGroups.tenantId, tenantId),
          eq(catalogueModifierGroups.status, "active"),
        ),
      );

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
