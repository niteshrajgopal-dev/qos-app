import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenuLiveRevisions,
  catalogueMenus,
  type MenuLiveSnapshotPayload,
  type PublicMenuProductSnapshot,
} from "@/db/schema";

export class BasketMenuEligibilityError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "BasketMenuEligibilityError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export async function loadPublishedMenuSnapshot(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  locationId: string,
) {
  const [menu] = await tx
    .select({ status: catalogueMenus.status })
    .from(catalogueMenus)
    .where(and(eq(catalogueMenus.tenantId, tenantId), eq(catalogueMenus.id, menuId)))
    .limit(1);

  if (!menu || menu.status === "archived") {
    throw new BasketMenuEligibilityError(
      "Published menu is unavailable for this location.",
      404,
    );
  }

  const [revision] = await tx
    .select({ payload: catalogueMenuLiveRevisions.payload })
    .from(catalogueMenuLiveRevisions)
    .where(
      and(
        eq(catalogueMenuLiveRevisions.tenantId, tenantId),
        eq(catalogueMenuLiveRevisions.menuId, menuId),
        eq(catalogueMenuLiveRevisions.locationId, locationId),
      ),
    )
    .limit(1);

  if (!revision?.payload) {
    throw new BasketMenuEligibilityError(
      "Published menu is unavailable for this location.",
      404,
    );
  }

  return revision.payload;
}

export function buildPublishedProductIndex(snapshot: MenuLiveSnapshotPayload) {
  const products = new Map<string, PublicMenuProductSnapshot>();

  for (const section of snapshot.sections) {
    for (const product of section.products) {
      products.set(product.productPublicId, product);
    }
  }

  return products;
}

export function resolvePublishedProduct(
  snapshot: MenuLiveSnapshotPayload,
  productPublicId: string,
) {
  const index = buildPublishedProductIndex(snapshot);
  const product = index.get(productPublicId);

  if (!product) {
    throw new BasketMenuEligibilityError(
      "Product is not available on the published menu.",
      400,
      "productPublicId",
    );
  }

  return product;
}
