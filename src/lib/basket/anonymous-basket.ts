import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenus,
  locations,
  storefrontAnonymousBasketLines,
  storefrontAnonymousBasketMutations,
  storefrontAnonymousBaskets,
  storefrontAnonymousSessions,
  storefrontPublishedCollections,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  type AnonymousBasketResponse,
  BASKET_CONTRACT_VERSION,
  parseBasketLocale,
} from "@/lib/basket/basket-contract";
import { readAnonymousBasketConfig } from "@/lib/basket/config";
import {
  loadPublishedMenuSnapshot,
  resolvePublishedProduct,
} from "@/lib/basket/menu-eligibility";
import {
  AnonymousBasketAuthError,
  assertCsrfProtection,
} from "@/lib/basket/session-cookies";
import { withTenantContext } from "@/lib/tenant/context";

export class AnonymousBasketError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "AnonymousBasketError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateSessionToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16);
}

function generateCsrfToken() {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

function generateBasketPublicId() {
  return `bsk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function generateLinePublicId() {
  return `bln_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

type SessionContext = {
  tenantId: string;
  sessionId: string;
  basketId: string;
  csrfToken: string;
  sessionToken: string;
  maxAgeSeconds: number;
};

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
    throw new AnonymousBasketError("Storefront not found.", 404, "storefrontPublicId");
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
    throw new AnonymousBasketError("Location not found.", 404, "locationPublicId");
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
    throw new AnonymousBasketError(
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
    throw new AnonymousBasketError(
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
): Promise<AnonymousBasketResponse> {
  const [basket] = await tx
    .select()
    .from(storefrontAnonymousBaskets)
    .where(
      and(
        eq(storefrontAnonymousBaskets.tenantId, tenantId),
        eq(storefrontAnonymousBaskets.id, basketId),
      ),
    )
    .limit(1);

  if (!basket || basket.status !== "active") {
    throw new AnonymousBasketError("Basket not found.", 404);
  }

  const [session] = await tx
    .select()
    .from(storefrontAnonymousSessions)
    .where(
      and(
        eq(storefrontAnonymousSessions.tenantId, tenantId),
        eq(storefrontAnonymousSessions.id, basket.sessionId),
      ),
    )
    .limit(1);

  if (!session || session.status !== "active") {
    throw new AnonymousBasketError("Basket session has expired.", 410);
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
        eq(storefronts.id, session.storefrontId),
      ),
    )
    .limit(1);

  const [location] = await tx
    .select({ publicId: locations.publicId })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.id, session.locationId),
      ),
    )
    .limit(1);

  const [menu] = await tx
    .select({ publicId: catalogueMenus.publicId })
    .from(catalogueMenus)
    .where(
      and(
        eq(catalogueMenus.tenantId, tenantId),
        eq(catalogueMenus.id, session.menuId),
      ),
    )
    .limit(1);

  if (!tenant || !storefront || !location || !menu) {
    throw new AnonymousBasketError("Basket not found.", 404);
  }

  const snapshot = await loadPublishedMenuSnapshot(
    tx,
    tenantId,
    session.menuId,
    session.locationId,
  );

  const lines = await tx
    .select()
    .from(storefrontAnonymousBasketLines)
    .where(
      and(
        eq(storefrontAnonymousBasketLines.tenantId, tenantId),
        eq(storefrontAnonymousBasketLines.basketId, basket.id),
      ),
    )
    .orderBy(asc(storefrontAnonymousBasketLines.sortOrder));

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
    basketPublicId: basket.publicId,
    version: basket.version,
    tenantPublicId: tenant.publicId,
    storefrontPublicId: storefront.publicId,
    locationPublicId: location.publicId,
    menuPublicId: menu.publicId,
    menuReleaseVersion: snapshot.version,
    currency: session.currency,
    locale: parseBasketLocale(session.locale),
    lines: responseLines,
    itemCount,
    provisionalSubtotalMinor,
  };
}

async function authenticateSession(
  db: DbClient,
  sessionToken: string | null,
): Promise<SessionContext> {
  if (!sessionToken?.trim()) {
    throw new AnonymousBasketAuthError("Anonymous basket session is required.", 401);
  }

  const config = readAnonymousBasketConfig();
  const sessionTokenHash = hashSessionToken(sessionToken);

  const [session] = await db
    .select()
    .from(storefrontAnonymousSessions)
    .where(eq(storefrontAnonymousSessions.sessionTokenHash, sessionTokenHash))
    .limit(1);

  if (!session) {
    throw new AnonymousBasketAuthError("Anonymous basket session is invalid.", 401);
  }

  const now = Date.now();
  const idleDeadline =
    session.lastActiveAt.getTime() + config.sessionIdleSeconds * 1000;

  if (
    session.status !== "active" ||
    session.expiresAt.getTime() <= now ||
    idleDeadline <= now
  ) {
    await withTenantContext(db, session.tenantId, async (tx) => {
      await tx
        .update(storefrontAnonymousSessions)
        .set({ status: "expired" })
        .where(eq(storefrontAnonymousSessions.id, session.id));

      const [basket] = await tx
        .select({ id: storefrontAnonymousBaskets.id })
        .from(storefrontAnonymousBaskets)
        .where(
          and(
            eq(storefrontAnonymousBaskets.tenantId, session.tenantId),
            eq(storefrontAnonymousBaskets.sessionId, session.id),
          ),
        )
        .limit(1);

      if (basket) {
        await tx
          .update(storefrontAnonymousBaskets)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(storefrontAnonymousBaskets.id, basket.id));
      }
    });

    throw new AnonymousBasketError(
      "Basket session has expired. Start a new basket.",
      410,
    );
  }

  return withTenantContext(db, session.tenantId, async (tx) => {
    await tx
      .update(storefrontAnonymousSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(storefrontAnonymousSessions.id, session.id));

    const [basket] = await tx
      .select()
      .from(storefrontAnonymousBaskets)
      .where(
        and(
          eq(storefrontAnonymousBaskets.tenantId, session.tenantId),
          eq(storefrontAnonymousBaskets.sessionId, session.id),
        ),
      )
      .limit(1);

    if (!basket || basket.status !== "active") {
      throw new AnonymousBasketError("Basket not found.", 404);
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - now) / 1000),
    );

    return {
      tenantId: session.tenantId,
      sessionId: session.id,
      basketId: basket.id,
      csrfToken: session.csrfToken,
      sessionToken,
      maxAgeSeconds: remainingSeconds,
    };
  });
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
    .select({ responseSnapshot: storefrontAnonymousBasketMutations.responseSnapshot })
    .from(storefrontAnonymousBasketMutations)
    .where(
      and(
        eq(storefrontAnonymousBasketMutations.tenantId, tenantId),
        eq(storefrontAnonymousBasketMutations.basketId, basketId),
        eq(storefrontAnonymousBasketMutations.mutationId, mutationId),
      ),
    )
    .limit(1);

  return (existing?.responseSnapshot as AnonymousBasketResponse | undefined) ?? null;
}

async function storeIdempotentMutation(
  tx: DbClient,
  tenantId: string,
  basketId: string,
  mutationId: string | undefined,
  response: AnonymousBasketResponse,
) {
  if (!mutationId?.trim()) {
    return;
  }

  await tx.insert(storefrontAnonymousBasketMutations).values({
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
    throw new AnonymousBasketError(
      "expectedVersion is required for basket mutations.",
      400,
      "expectedVersion",
    );
  }

  if (expectedVersion !== currentVersion) {
    throw new AnonymousBasketError(
      "Basket version conflict. Reload the basket and retry.",
      409,
      "expectedVersion",
    );
  }
}

export async function createAnonymousBasket(
  db: DbClient,
  input: {
    storefrontPublicId: string;
    locationPublicId: string;
    locale?: string | null;
  },
) {
  const config = readAnonymousBasketConfig();
  const locale = parseBasketLocale(input.locale);
  const sessionToken = generateSessionToken();
  const csrfToken = generateCsrfToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000);

  const [storefrontRow] = await db
    .select({ tenantId: storefronts.tenantId })
    .from(storefronts)
    .where(eq(storefronts.publicId, input.storefrontPublicId))
    .limit(1);

  if (!storefrontRow) {
    throw new AnonymousBasketError("Storefront not found.", 404, "storefrontPublicId");
  }

  return withTenantContext(db, storefrontRow.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ publicId: tenants.publicId, baseCurrency: tenants.baseCurrency })
      .from(tenants)
      .where(eq(tenants.id, storefrontRow.tenantId))
      .limit(1);

    if (!tenant) {
      throw new AnonymousBasketError("Storefront not found.", 404, "storefrontPublicId");
    }

    const binding = await resolveStorefrontBinding(
      tx,
      storefrontRow.tenantId,
      input.storefrontPublicId,
      input.locationPublicId,
    );

    await loadPublishedMenuSnapshot(
      tx,
      storefrontRow.tenantId,
      binding.menuId,
      binding.locationId,
    );

    const [session] = await tx
      .insert(storefrontAnonymousSessions)
      .values({
        tenantId: storefrontRow.tenantId,
        storefrontId: binding.storefrontId,
        locationId: binding.locationId,
        menuId: binding.menuId,
        sessionTokenHash: hashSessionToken(sessionToken),
        csrfToken,
        locale,
        currency: tenant.baseCurrency,
        expiresAt,
      })
      .returning();

    const [basket] = await tx
      .insert(storefrontAnonymousBaskets)
      .values({
        tenantId: storefrontRow.tenantId,
        sessionId: session.id,
        publicId: generateBasketPublicId(),
      })
      .returning();

    const response = await buildBasketResponse(
      tx,
      storefrontRow.tenantId,
      basket.id,
    );

    return {
      basket: response,
      sessionToken,
      csrfToken,
      maxAgeSeconds: config.sessionTtlSeconds,
    };
  });
}

export async function getAnonymousBasket(db: DbClient, sessionToken: string | null) {
  const context = await authenticateSession(db, sessionToken);

  return withTenantContext(db, context.tenantId, async (tx) =>
    buildBasketResponse(tx, context.tenantId, context.basketId),
  );
}

export async function upsertAnonymousBasketLine(
  db: DbClient,
  request: Request,
  sessionToken: string | null,
  input: {
    productPublicId: string;
    quantity: number;
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const context = await authenticateSession(db, sessionToken);
  assertCsrfProtection(request, context.csrfToken);

  const config = readAnonymousBasketConfig();

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AnonymousBasketError("quantity must be a positive integer.", 400, "quantity");
  }

  if (input.quantity > config.maxLineQuantity) {
    throw new AnonymousBasketError(
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
      .from(storefrontAnonymousBaskets)
      .where(
        and(
          eq(storefrontAnonymousBaskets.tenantId, context.tenantId),
          eq(storefrontAnonymousBaskets.id, context.basketId),
        ),
      )
      .limit(1);

    if (!basket) {
      throw new AnonymousBasketError("Basket not found.", 404);
    }

    assertExpectedVersion(basket.version, input.expectedVersion);

    const [session] = await tx
      .select()
      .from(storefrontAnonymousSessions)
      .where(
        and(
          eq(storefrontAnonymousSessions.tenantId, context.tenantId),
          eq(storefrontAnonymousSessions.id, basket.sessionId),
        ),
      )
      .limit(1);

    if (!session) {
      throw new AnonymousBasketError("Basket not found.", 404);
    }

    const snapshot = await loadPublishedMenuSnapshot(
      tx,
      context.tenantId,
      session.menuId,
      session.locationId,
    );
    const product = resolvePublishedProduct(snapshot, input.productPublicId);

    const [existingLine] = await tx
      .select()
      .from(storefrontAnonymousBasketLines)
      .where(
        and(
          eq(storefrontAnonymousBasketLines.tenantId, context.tenantId),
          eq(storefrontAnonymousBasketLines.basketId, basket.id),
          eq(
            storefrontAnonymousBasketLines.productPublicId,
            input.productPublicId,
          ),
        ),
      )
      .limit(1);

    if (existingLine) {
      await tx
        .update(storefrontAnonymousBasketLines)
        .set({
          quantity: input.quantity,
          unitAmountMinor: product.price.amountMinor,
          unitCurrency: product.price.currency,
          updatedAt: new Date(),
        })
        .where(eq(storefrontAnonymousBasketLines.id, existingLine.id));
    } else {
      const lineCount = await tx
        .select({ id: storefrontAnonymousBasketLines.id })
        .from(storefrontAnonymousBasketLines)
        .where(
          and(
            eq(storefrontAnonymousBasketLines.tenantId, context.tenantId),
            eq(storefrontAnonymousBasketLines.basketId, basket.id),
          ),
        );

      if (lineCount.length >= config.maxLines) {
        throw new AnonymousBasketError(
          "Basket line limit reached.",
          400,
          "productPublicId",
        );
      }

      await tx.insert(storefrontAnonymousBasketLines).values({
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
      .update(storefrontAnonymousBaskets)
      .set({
        version: basket.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(storefrontAnonymousBaskets.id, basket.id))
      .returning();

    if (!updatedBasket) {
      throw new AnonymousBasketError("Basket not found.", 404);
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

export async function updateAnonymousBasketLineQuantity(
  db: DbClient,
  request: Request,
  sessionToken: string | null,
  linePublicId: string,
  input: {
    quantity: number;
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const context = await authenticateSession(db, sessionToken);
  assertCsrfProtection(request, context.csrfToken);

  const config = readAnonymousBasketConfig();

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new AnonymousBasketError("quantity must be a positive integer.", 400, "quantity");
  }

  if (input.quantity > config.maxLineQuantity) {
    throw new AnonymousBasketError(
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
      .from(storefrontAnonymousBaskets)
      .where(
        and(
          eq(storefrontAnonymousBaskets.tenantId, context.tenantId),
          eq(storefrontAnonymousBaskets.id, context.basketId),
        ),
      )
      .limit(1);

    if (!basket) {
      throw new AnonymousBasketError("Basket not found.", 404);
    }

    assertExpectedVersion(basket.version, input.expectedVersion);

    const [line] = await tx
      .select()
      .from(storefrontAnonymousBasketLines)
      .where(
        and(
          eq(storefrontAnonymousBasketLines.tenantId, context.tenantId),
          eq(storefrontAnonymousBasketLines.basketId, basket.id),
          eq(storefrontAnonymousBasketLines.publicId, linePublicId),
        ),
      )
      .limit(1);

    if (!line) {
      throw new AnonymousBasketError("Basket line not found.", 404, "linePublicId");
    }

    await tx
      .update(storefrontAnonymousBasketLines)
      .set({ quantity: input.quantity, updatedAt: new Date() })
      .where(eq(storefrontAnonymousBasketLines.id, line.id));

    const [updatedBasket] = await tx
      .update(storefrontAnonymousBaskets)
      .set({
        version: basket.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(storefrontAnonymousBaskets.id, basket.id))
      .returning();

    if (!updatedBasket) {
      throw new AnonymousBasketError("Basket not found.", 404);
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

export async function removeAnonymousBasketLine(
  db: DbClient,
  request: Request,
  sessionToken: string | null,
  linePublicId: string,
  input: {
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const context = await authenticateSession(db, sessionToken);
  assertCsrfProtection(request, context.csrfToken);

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
      .from(storefrontAnonymousBaskets)
      .where(
        and(
          eq(storefrontAnonymousBaskets.tenantId, context.tenantId),
          eq(storefrontAnonymousBaskets.id, context.basketId),
        ),
      )
      .limit(1);

    if (!basket) {
      throw new AnonymousBasketError("Basket not found.", 404);
    }

    assertExpectedVersion(basket.version, input.expectedVersion);

    const [line] = await tx
      .select({ id: storefrontAnonymousBasketLines.id })
      .from(storefrontAnonymousBasketLines)
      .where(
        and(
          eq(storefrontAnonymousBasketLines.tenantId, context.tenantId),
          eq(storefrontAnonymousBasketLines.basketId, basket.id),
          eq(storefrontAnonymousBasketLines.publicId, linePublicId),
        ),
      )
      .limit(1);

    if (!line) {
      throw new AnonymousBasketError("Basket line not found.", 404, "linePublicId");
    }

    await tx
      .delete(storefrontAnonymousBasketLines)
      .where(eq(storefrontAnonymousBasketLines.id, line.id));

    const [updatedBasket] = await tx
      .update(storefrontAnonymousBaskets)
      .set({
        version: basket.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(storefrontAnonymousBaskets.id, basket.id))
      .returning();

    if (!updatedBasket) {
      throw new AnonymousBasketError("Basket not found.", 404);
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

export async function rejectAnonymousCheckoutQuote(
  db: DbClient,
  sessionToken: string | null,
  request?: Request,
) {
  await authenticateSession(db, sessionToken);

  if (!request) {
    throw new AnonymousBasketError(
      "Checkout requires verified customer sign-in.",
      401,
    );
  }

  const { requireVerifiedCustomerSession } = await import(
    "@/lib/customer/session"
  );
  await requireVerifiedCustomerSession(request);
}

export function basketPrivateCacheControl() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}
