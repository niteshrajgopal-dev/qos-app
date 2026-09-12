import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenus,
  locations,
  storefrontCustomerBasketLines,
  storefrontCustomerBasketMutations,
  storefrontCustomerBaskets,
  storefrontPublishedCollections,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  BASKET_CONTRACT_VERSION,
  type CustomerBasketResponse,
  parseBasketLocale,
} from "@/lib/basket/basket-contract";
import { readAnonymousBasketConfig } from "@/lib/basket/config";
import {
  loadPublishedMenuSnapshot,
  resolvePublishedProduct,
} from "@/lib/basket/menu-eligibility";
import { requireVerifiedCustomerSession } from "@/lib/customer/session";
import { withTenantContext } from "@/lib/tenant/context";

export class CustomerBasketError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CustomerBasketError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export type BasketContextInput = {
  storefrontPublicId: string;
  locationPublicId: string;
  locale?: string | null;
};

function generateBasketPublicId() {
  return `bsk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function generateLinePublicId() {
  return `bln_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function parseBasketContextInput(input: BasketContextInput) {
  if (!input.storefrontPublicId?.trim()) {
    throw new CustomerBasketError(
      "storefrontPublicId is required.",
      400,
      "storefrontPublicId",
    );
  }

  if (!input.locationPublicId?.trim()) {
    throw new CustomerBasketError(
      "locationPublicId is required.",
      400,
      "locationPublicId",
    );
  }

  return {
    storefrontPublicId: input.storefrontPublicId.trim(),
    locationPublicId: input.locationPublicId.trim(),
    locale: parseBasketLocale(input.locale),
  };
}

async function resolveStorefrontBinding(
  tx: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  locationPublicId: string,
) {
  const [storefront] = await tx
    .select({
      id: storefronts.id,
      publicId: storefronts.publicId,
      status: storefronts.status,
    })
    .from(storefronts)
    .where(
      and(
        eq(storefronts.tenantId, tenantId),
        eq(storefronts.publicId, storefrontPublicId),
      ),
    )
    .limit(1);

  if (!storefront || storefront.status === "archived") {
    throw new CustomerBasketError("Storefront not found.", 404, "storefrontPublicId");
  }

  const [location] = await tx
    .select({ id: locations.id, publicId: locations.publicId })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.publicId, locationPublicId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new CustomerBasketError("Location not found.", 404, "locationPublicId");
  }

  const [collection] = await tx
    .select({ menuId: storefrontPublishedCollections.menuId })
    .from(storefrontPublishedCollections)
    .where(
      and(
        eq(storefrontPublishedCollections.tenantId, tenantId),
        eq(storefrontPublishedCollections.storefrontId, storefront.id),
        eq(storefrontPublishedCollections.locationId, location.id),
      ),
    )
    .limit(1);

  if (!collection) {
    throw new CustomerBasketError(
      "No published menu is assigned to this storefront location.",
      404,
      "locationPublicId",
    );
  }

  const [menu] = await tx
    .select({ id: catalogueMenus.id, publicId: catalogueMenus.publicId })
    .from(catalogueMenus)
    .where(
      and(
        eq(catalogueMenus.tenantId, tenantId),
        eq(catalogueMenus.id, collection.menuId),
      ),
    )
    .limit(1);

  if (!menu) {
    throw new CustomerBasketError(
      "No published menu is assigned to this storefront location.",
      404,
      "locationPublicId",
    );
  }

  return {
    storefrontId: storefront.id,
    storefrontPublicId: storefront.publicId,
    locationId: location.id,
    locationPublicId: location.publicId,
    menuId: menu.id,
    menuPublicId: menu.publicId,
  };
}

async function buildBasketResponse(
  tx: DbClient,
  tenantId: string,
  basketId: string,
): Promise<CustomerBasketResponse> {
  const [basket] = await tx
    .select()
    .from(storefrontCustomerBaskets)
    .where(
      and(
        eq(storefrontCustomerBaskets.tenantId, tenantId),
        eq(storefrontCustomerBaskets.id, basketId),
      ),
    )
    .limit(1);

  if (!basket || basket.status !== "active") {
    throw new CustomerBasketError("Basket not found.", 404);
  }

  const [tenant] = await tx
    .select({ publicId: tenants.publicId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const [storefront] = await tx
    .select({ publicId: storefronts.publicId })
    .from(storefronts)
    .where(
      and(
        eq(storefronts.tenantId, tenantId),
        eq(storefronts.id, basket.storefrontId),
      ),
    )
    .limit(1);

  const [location] = await tx
    .select({ publicId: locations.publicId })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.id, basket.locationId),
      ),
    )
    .limit(1);

  const [menu] = await tx
    .select({ publicId: catalogueMenus.publicId })
    .from(catalogueMenus)
    .where(
      and(
        eq(catalogueMenus.tenantId, tenantId),
        eq(catalogueMenus.id, basket.menuId),
      ),
    )
    .limit(1);

  if (!tenant || !storefront || !location || !menu) {
    throw new CustomerBasketError("Basket not found.", 404);
  }

  const snapshot = await loadPublishedMenuSnapshot(
    tx,
    tenantId,
    basket.menuId,
    basket.locationId,
  );

  const lines = await tx
    .select()
    .from(storefrontCustomerBasketLines)
    .where(
      and(
        eq(storefrontCustomerBasketLines.tenantId, tenantId),
        eq(storefrontCustomerBasketLines.basketId, basket.id),
      ),
    )
    .orderBy(asc(storefrontCustomerBasketLines.sortOrder));

  const responseLines = lines.map((line) => ({
    linePublicId: line.publicId,
    productPublicId: line.productPublicId,
    quantity: line.quantity,
    unitPrice: {
      amountMinor: line.unitAmountMinor,
      currency: line.unitCurrency,
    },
  }));

  const itemCount = responseLines.reduce((total, line) => total + line.quantity, 0);
  const provisionalSubtotalMinor = responseLines.reduce(
    (total, line) => total + line.quantity * line.unitPrice.amountMinor,
    0,
  );

  return {
    contractVersion: BASKET_CONTRACT_VERSION,
    ownership: "account",
    basketPublicId: basket.publicId,
    version: basket.version,
    tenantPublicId: tenant.publicId,
    storefrontPublicId: storefront.publicId,
    locationPublicId: location.publicId,
    menuPublicId: menu.publicId,
    menuReleaseVersion: snapshot.version,
    currency: basket.currency,
    locale: parseBasketLocale(basket.locale),
    lines: responseLines,
    itemCount,
    provisionalSubtotalMinor,
  };
}

async function readIdempotentMutation(
  tx: DbClient,
  tenantId: string,
  basketId: string,
  mutationId: string | undefined,
) {
  if (!mutationId?.trim()) {
    return null;
  }

  const [existing] = await tx
    .select({ responseSnapshot: storefrontCustomerBasketMutations.responseSnapshot })
    .from(storefrontCustomerBasketMutations)
    .where(
      and(
        eq(storefrontCustomerBasketMutations.tenantId, tenantId),
        eq(storefrontCustomerBasketMutations.basketId, basketId),
        eq(storefrontCustomerBasketMutations.mutationId, mutationId),
      ),
    )
    .limit(1);

  return (existing?.responseSnapshot as CustomerBasketResponse | undefined) ?? null;
}

async function storeIdempotentMutation(
  tx: DbClient,
  tenantId: string,
  basketId: string,
  mutationId: string | undefined,
  response: CustomerBasketResponse,
) {
  if (!mutationId?.trim()) {
    return;
  }

  await tx.insert(storefrontCustomerBasketMutations).values({
    tenantId,
    basketId,
    mutationId,
    responseSnapshot: response,
  });
}

function assertExpectedVersion(
  currentVersion: number,
  expectedVersion: number | undefined,
) {
  if (expectedVersion === undefined) {
    throw new CustomerBasketError(
      "expectedVersion is required for basket mutations.",
      400,
      "expectedVersion",
    );
  }

  if (expectedVersion !== currentVersion) {
    throw new CustomerBasketError(
      "Basket version conflict. Reload the basket and retry.",
      409,
      "expectedVersion",
    );
  }
}

type AccountBasketContext = {
  tenantId: string;
  basketId: string;
  customerUserId: string;
};

export async function resolveCustomerAccountBasketContext(
  db: DbClient,
  request: Request,
  input: BasketContextInput,
): Promise<AccountBasketContext> {
  const session = await requireVerifiedCustomerSession(request);
  const context = parseBasketContextInput(input);

  const [storefrontRow] = await db
    .select({ tenantId: storefronts.tenantId })
    .from(storefronts)
    .where(eq(storefronts.publicId, context.storefrontPublicId))
    .limit(1);

  if (!storefrontRow) {
    throw new CustomerBasketError("Storefront not found.", 404, "storefrontPublicId");
  }

  return withTenantContext(db, storefrontRow.tenantId, async (tx) => {
    const binding = await resolveStorefrontBinding(
      tx,
      storefrontRow.tenantId,
      context.storefrontPublicId,
      context.locationPublicId,
    );

    await loadPublishedMenuSnapshot(
      tx,
      storefrontRow.tenantId,
      binding.menuId,
      binding.locationId,
    );

    const [tenant] = await tx
      .select({ baseCurrency: tenants.baseCurrency })
      .from(tenants)
      .where(eq(tenants.id, storefrontRow.tenantId))
      .limit(1);

    if (!tenant) {
      throw new CustomerBasketError("Storefront not found.", 404, "storefrontPublicId");
    }

    let [basket] = await tx
      .select()
      .from(storefrontCustomerBaskets)
      .where(
        and(
          eq(storefrontCustomerBaskets.tenantId, storefrontRow.tenantId),
          eq(storefrontCustomerBaskets.customerUserId, session.user.id),
          eq(storefrontCustomerBaskets.storefrontId, binding.storefrontId),
          eq(storefrontCustomerBaskets.locationId, binding.locationId),
        ),
      )
      .limit(1);

    if (!basket) {
      [basket] = await tx
        .insert(storefrontCustomerBaskets)
        .values({
          tenantId: storefrontRow.tenantId,
          storefrontId: binding.storefrontId,
          locationId: binding.locationId,
          menuId: binding.menuId,
          customerUserId: session.user.id,
          publicId: generateBasketPublicId(),
          locale: context.locale,
          currency: tenant.baseCurrency,
        })
        .returning();
    }

    if (basket.status !== "active") {
      throw new CustomerBasketError("Basket not found.", 404);
    }

    return {
      tenantId: storefrontRow.tenantId,
      basketId: basket.id,
      customerUserId: session.user.id,
    };
  });
}

export async function buildCustomerAccountBasketResponse(
  tx: DbClient,
  tenantId: string,
  basketId: string,
) {
  return buildBasketResponse(tx, tenantId, basketId);
}

export async function getCustomerAccountBasket(
  db: DbClient,
  request: Request,
  input: BasketContextInput,
) {
  const context = await resolveCustomerAccountBasketContext(db, request, input);

  return withTenantContext(db, context.tenantId, async (tx) =>
    buildBasketResponse(tx, context.tenantId, context.basketId),
  );
}

export async function upsertCustomerAccountBasketLine(
  db: DbClient,
  request: Request,
  input: BasketContextInput & {
    productPublicId: string;
    quantity: number;
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const context = await resolveCustomerAccountBasketContext(db, request, input);
  const config = readAnonymousBasketConfig();

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new CustomerBasketError("quantity must be a positive integer.", 400, "quantity");
  }

  if (input.quantity > config.maxLineQuantity) {
    throw new CustomerBasketError(
      "quantity exceeds the configured basket line limit.",
      400,
      "quantity",
    );
  }

  return withTenantContext(db, context.tenantId, async (tx) => {
    const cached = await readIdempotentMutation(
      tx,
      context.tenantId,
      context.basketId,
      input.mutationId,
    );
    if (cached) {
      return cached;
    }

    const [basket] = await tx
      .select()
      .from(storefrontCustomerBaskets)
      .where(
        and(
          eq(storefrontCustomerBaskets.tenantId, context.tenantId),
          eq(storefrontCustomerBaskets.id, context.basketId),
          eq(storefrontCustomerBaskets.customerUserId, context.customerUserId),
        ),
      )
      .limit(1);

    if (!basket) {
      throw new CustomerBasketError("Basket not found.", 404);
    }

    assertExpectedVersion(basket.version, input.expectedVersion);

    const snapshot = await loadPublishedMenuSnapshot(
      tx,
      context.tenantId,
      basket.menuId,
      basket.locationId,
    );
    const product = resolvePublishedProduct(snapshot, input.productPublicId);

    const [existingLine] = await tx
      .select()
      .from(storefrontCustomerBasketLines)
      .where(
        and(
          eq(storefrontCustomerBasketLines.tenantId, context.tenantId),
          eq(storefrontCustomerBasketLines.basketId, basket.id),
          eq(storefrontCustomerBasketLines.productPublicId, input.productPublicId),
        ),
      )
      .limit(1);

    if (existingLine) {
      await tx
        .update(storefrontCustomerBasketLines)
        .set({
          quantity: input.quantity,
          unitAmountMinor: product.price.amountMinor,
          unitCurrency: product.price.currency,
          updatedAt: new Date(),
        })
        .where(eq(storefrontCustomerBasketLines.id, existingLine.id));
    } else {
      const lineCount = await tx
        .select({ id: storefrontCustomerBasketLines.id })
        .from(storefrontCustomerBasketLines)
        .where(
          and(
            eq(storefrontCustomerBasketLines.tenantId, context.tenantId),
            eq(storefrontCustomerBasketLines.basketId, basket.id),
          ),
        );

      if (lineCount.length >= config.maxLines) {
        throw new CustomerBasketError(
          "Basket line limit reached.",
          400,
          "productPublicId",
        );
      }

      await tx.insert(storefrontCustomerBasketLines).values({
        tenantId: context.tenantId,
        basketId: basket.id,
        publicId: generateLinePublicId(),
        productPublicId: input.productPublicId,
        quantity: input.quantity,
        unitAmountMinor: product.price.amountMinor,
        unitCurrency: product.price.currency,
        sortOrder: lineCount.length,
      });
    }

    const [updatedBasket] = await tx
      .update(storefrontCustomerBaskets)
      .set({
        version: basket.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storefrontCustomerBaskets.id, basket.id),
          eq(storefrontCustomerBaskets.customerUserId, context.customerUserId),
        ),
      )
      .returning();

    if (!updatedBasket) {
      throw new CustomerBasketError("Basket not found.", 404);
    }

    const response = await buildBasketResponse(
      tx,
      context.tenantId,
      updatedBasket.id,
    );
    await storeIdempotentMutation(
      tx,
      context.tenantId,
      updatedBasket.id,
      input.mutationId,
      response,
    );

    return response;
  });
}

export async function removeCustomerAccountBasketLine(
  db: DbClient,
  request: Request,
  linePublicId: string,
  input: BasketContextInput & {
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const context = await resolveCustomerAccountBasketContext(db, request, input);

  return withTenantContext(db, context.tenantId, async (tx) => {
    const cached = await readIdempotentMutation(
      tx,
      context.tenantId,
      context.basketId,
      input.mutationId,
    );
    if (cached) {
      return cached;
    }

    const [basket] = await tx
      .select()
      .from(storefrontCustomerBaskets)
      .where(
        and(
          eq(storefrontCustomerBaskets.tenantId, context.tenantId),
          eq(storefrontCustomerBaskets.id, context.basketId),
          eq(storefrontCustomerBaskets.customerUserId, context.customerUserId),
        ),
      )
      .limit(1);

    if (!basket) {
      throw new CustomerBasketError("Basket not found.", 404);
    }

    assertExpectedVersion(basket.version, input.expectedVersion);

    const [line] = await tx
      .select({ id: storefrontCustomerBasketLines.id })
      .from(storefrontCustomerBasketLines)
      .where(
        and(
          eq(storefrontCustomerBasketLines.tenantId, context.tenantId),
          eq(storefrontCustomerBasketLines.basketId, basket.id),
          eq(storefrontCustomerBasketLines.publicId, linePublicId),
        ),
      )
      .limit(1);

    if (!line) {
      throw new CustomerBasketError("Basket line not found.", 404, "linePublicId");
    }

    await tx
      .delete(storefrontCustomerBasketLines)
      .where(eq(storefrontCustomerBasketLines.id, line.id));

    const [updatedBasket] = await tx
      .update(storefrontCustomerBaskets)
      .set({
        version: basket.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storefrontCustomerBaskets.id, basket.id),
          eq(storefrontCustomerBaskets.customerUserId, context.customerUserId),
        ),
      )
      .returning();

    if (!updatedBasket) {
      throw new CustomerBasketError("Basket not found.", 404);
    }

    const response = await buildBasketResponse(
      tx,
      context.tenantId,
      updatedBasket.id,
    );
    await storeIdempotentMutation(
      tx,
      context.tenantId,
      updatedBasket.id,
      input.mutationId,
      response,
    );

    return response;
  });
}
