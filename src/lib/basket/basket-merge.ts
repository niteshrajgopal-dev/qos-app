import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  storefrontAnonymousBaskets,
  storefrontAnonymousSessions,
  storefrontBasketMergeOperations,
  storefrontCustomerBasketLines,
  storefrontCustomerBaskets,
  storefronts,
} from "@/db/schema";
import {
  getAnonymousBasket,
  resolveAnonymousBasketSession,
} from "@/lib/basket/anonymous-basket";
import {
  BASKET_CONTRACT_VERSION,
  BASKET_MERGE_DECISIONS,
  type AnonymousBasketResponse,
  type BasketMergeCommitResponse,
  type BasketMergeDecision,
  type BasketMergeLineValidation,
  type BasketMergePreviewResponse,
  type BasketLineResponse,
  type CustomerBasketResponse,
} from "@/lib/basket/basket-contract";
import { readAnonymousBasketConfig } from "@/lib/basket/config";
import {
  buildPublishedProductIndex,
  loadPublishedMenuSnapshot,
} from "@/lib/basket/menu-eligibility";
import {
  assertCsrfProtection,
} from "@/lib/basket/session-cookies";
import { requireVerifiedCustomerSession } from "@/lib/customer/session";
import { withTenantContext } from "@/lib/tenant/context";
import {
  buildCustomerAccountBasketResponse,
  getCustomerAccountBasket,
} from "@/lib/basket/customer-basket";

export class BasketMergeError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly lineValidations?: BasketMergeLineValidation[];

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    lineValidations?: BasketMergeLineValidation[],
  ) {
    super(message);
    this.name = "BasketMergeError";
    this.statusCode = statusCode;
    this.field = field;
    this.lineValidations = lineValidations;
  }
}

function generateLinePublicId() {
  return `bln_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function buildBasketMergePayloadHash(input: {
  decision: BasketMergeDecision;
  anonymousBasketPublicId: string;
  accountBasketPublicId: string;
  anonymousVersion: number;
  accountVersion: number;
}) {
  return createHash("sha256")
    .update(
      `${input.decision}:${input.anonymousBasketPublicId}:${input.accountBasketPublicId}:${input.anonymousVersion}:${input.accountVersion}`,
    )
    .digest("hex");
}

function parseMergeDecision(value: unknown): BasketMergeDecision {
  if (
    typeof value !== "string" ||
    !BASKET_MERGE_DECISIONS.includes(value as BasketMergeDecision)
  ) {
    throw new BasketMergeError(
      "decision must be keep_account, replace_with_anonymous, or merge.",
      400,
      "decision",
    );
  }

  return value as BasketMergeDecision;
}

function assertSameContext(
  anonymousBasket: AnonymousBasketResponse,
  accountBasket: CustomerBasketResponse,
) {
  if (anonymousBasket.tenantPublicId !== accountBasket.tenantPublicId) {
    throw new BasketMergeError(
      "Anonymous and account baskets belong to different tenants and cannot merge.",
      409,
      "context",
    );
  }

  if (anonymousBasket.storefrontPublicId !== accountBasket.storefrontPublicId) {
    throw new BasketMergeError(
      "Anonymous and account baskets belong to different storefronts and cannot merge.",
      409,
      "context",
    );
  }

  if (anonymousBasket.locationPublicId !== accountBasket.locationPublicId) {
    throw new BasketMergeError(
      "Anonymous and account baskets belong to different locations and cannot merge.",
      409,
      "context",
    );
  }

  if (anonymousBasket.currency !== accountBasket.currency) {
    throw new BasketMergeError(
      "Anonymous and account baskets use different currencies and cannot merge.",
      409,
      "context",
    );
  }
}

function buildWorkingLines(
  lines: BasketLineResponse[],
): Map<string, BasketLineResponse> {
  const map = new Map<string, BasketLineResponse>();
  for (const line of lines) {
    map.set(line.productPublicId, { ...line });
  }
  return map;
}

function toCustomerBasketResponse(
  template: CustomerBasketResponse,
  lines: BasketLineResponse[],
  version: number,
): CustomerBasketResponse {
  const itemCount = lines.reduce((total, line) => total + line.quantity, 0);
  const provisionalSubtotalMinor = lines.reduce(
    (total, line) => total + line.quantity * line.unitPrice.amountMinor,
    0,
  );

  return {
    ...template,
    version,
    lines,
    itemCount,
    provisionalSubtotalMinor,
  };
}

function computeDecisionLines(
  decision: BasketMergeDecision,
  anonymousBasket: AnonymousBasketResponse,
  accountBasket: CustomerBasketResponse,
  productIndex: ReturnType<typeof buildPublishedProductIndex>,
  config: ReturnType<typeof readAnonymousBasketConfig>,
): BasketLineResponse[] {
  if (decision === "keep_account") {
    return accountBasket.lines.map((line) => ({ ...line }));
  }

  if (decision === "replace_with_anonymous") {
    return anonymousBasket.lines.map((line) => {
      const product = productIndex.get(line.productPublicId);
      if (!product) {
        return { ...line };
      }

      return {
        ...line,
        unitPrice: {
          amountMinor: product.price.amountMinor,
          currency: product.price.currency,
        },
      };
    });
  }

  const merged = new Map<string, BasketLineResponse>();

  for (const line of accountBasket.lines) {
    merged.set(line.productPublicId, { ...line });
  }

  for (const line of anonymousBasket.lines) {
    const product = productIndex.get(line.productPublicId);
    const currentPrice = product
      ? {
          amountMinor: product.price.amountMinor,
          currency: product.price.currency,
        }
      : line.unitPrice;

    const existing = merged.get(line.productPublicId);
    if (existing) {
      merged.set(line.productPublicId, {
        ...existing,
        quantity: existing.quantity + line.quantity,
        unitPrice: currentPrice,
      });
    } else {
      merged.set(line.productPublicId, {
        linePublicId: line.linePublicId,
        productPublicId: line.productPublicId,
        quantity: line.quantity,
        unitPrice: currentPrice,
      });
    }
  }

  return [...merged.values()].slice(0, config.maxLines);
}

function validateMergeLines(
  anonymousBasket: AnonymousBasketResponse,
  accountBasket: CustomerBasketResponse,
  productIndex: ReturnType<typeof buildPublishedProductIndex>,
  config: ReturnType<typeof readAnonymousBasketConfig>,
): BasketMergeLineValidation[] {
  const validations: BasketMergeLineValidation[] = [];
  const seen = new Set<string>();

  for (const line of anonymousBasket.lines) {
    seen.add(line.productPublicId);
    const product = productIndex.get(line.productPublicId);
    if (!product) {
      validations.push({
        productPublicId: line.productPublicId,
        source: "anonymous",
        status: "unavailable",
        storedUnitPrice: line.unitPrice,
      });
      continue;
    }

    const currentUnitPrice = {
      amountMinor: product.price.amountMinor,
      currency: product.price.currency,
    };

    if (
      currentUnitPrice.amountMinor !== line.unitPrice.amountMinor ||
      currentUnitPrice.currency !== line.unitPrice.currency
    ) {
      validations.push({
        productPublicId: line.productPublicId,
        source: "anonymous",
        status: "price_changed",
        storedUnitPrice: line.unitPrice,
        currentUnitPrice,
      });
      continue;
    }

    validations.push({
      productPublicId: line.productPublicId,
      source: "anonymous",
      status: "ok",
      storedUnitPrice: line.unitPrice,
      currentUnitPrice,
    });
  }

  for (const line of accountBasket.lines) {
    if (seen.has(line.productPublicId)) {
      continue;
    }

    seen.add(line.productPublicId);
    const product = productIndex.get(line.productPublicId);
    if (!product) {
      validations.push({
        productPublicId: line.productPublicId,
        source: "account",
        status: "unavailable",
        storedUnitPrice: line.unitPrice,
      });
      continue;
    }

    const currentUnitPrice = {
      amountMinor: product.price.amountMinor,
      currency: product.price.currency,
    };

    if (
      currentUnitPrice.amountMinor !== line.unitPrice.amountMinor ||
      currentUnitPrice.currency !== line.unitPrice.currency
    ) {
      validations.push({
        productPublicId: line.productPublicId,
        source: "account",
        status: "price_changed",
        storedUnitPrice: line.unitPrice,
        currentUnitPrice,
      });
      continue;
    }

    validations.push({
      productPublicId: line.productPublicId,
      source: "account",
      status: "ok",
      storedUnitPrice: line.unitPrice,
      currentUnitPrice,
    });
  }

  for (const line of anonymousBasket.lines) {
    const accountLine = accountBasket.lines.find(
      (candidate) => candidate.productPublicId === line.productPublicId,
    );
    if (!accountLine) {
      continue;
    }

    const combinedQuantity = line.quantity + accountLine.quantity;
    if (combinedQuantity > config.maxLineQuantity) {
      validations.push({
        productPublicId: line.productPublicId,
        source: "both",
        status: "quantity_exceeds_limit",
        combinedQuantity,
        maxLineQuantity: config.maxLineQuantity,
      });
    }
  }

  return validations;
}

function assertCommitAllowed(
  decision: BasketMergeDecision,
  lineValidations: BasketMergeLineValidation[],
  proposedLines: BasketLineResponse[],
  config: ReturnType<typeof readAnonymousBasketConfig>,
) {
  const blocking = lineValidations.filter((validation) => {
    if (validation.status === "unavailable") {
      return decision === "replace_with_anonymous"
        ? validation.source === "anonymous"
        : true;
    }

    if (validation.status === "quantity_exceeds_limit") {
      return decision === "merge" && validation.source === "both";
    }

    return false;
  });

  const uniqueBlocking = [
    ...new Map(
      blocking.map((item) => [`${item.productPublicId}:${item.status}`, item]),
    ).values(),
  ];

  if (uniqueBlocking.length > 0) {
    throw new BasketMergeError(
      "Basket merge cannot proceed until validation issues are resolved.",
      400,
      "lineValidations",
      uniqueBlocking,
    );
  }

  for (const line of proposedLines) {
    if (line.quantity > config.maxLineQuantity) {
      throw new BasketMergeError(
        "Merged quantity exceeds the configured basket line limit.",
        400,
        "quantity",
        lineValidations,
      );
    }
  }

  if (proposedLines.length > config.maxLines) {
    throw new BasketMergeError(
      "Merged basket exceeds the configured line limit.",
      400,
      "lines",
      lineValidations,
    );
  }
}

async function resolveMergeParties(
  db: DbClient,
  request: Request,
  sessionToken: string | null,
) {
  const anonSession = await resolveAnonymousBasketSession(db, sessionToken);
  const anonymousBasket = await getAnonymousBasket(db, sessionToken);
  await requireVerifiedCustomerSession(request);

  const accountBasket = await getCustomerAccountBasket(db, request, {
    storefrontPublicId: anonymousBasket.storefrontPublicId,
    locationPublicId: anonymousBasket.locationPublicId,
    locale: anonymousBasket.locale,
  });

  assertSameContext(anonymousBasket, accountBasket);

  return {
    anonSession,
    anonymousBasket,
    accountBasket,
  };
}

function buildPreviewResponse(
  anonymousBasket: AnonymousBasketResponse,
  accountBasket: CustomerBasketResponse,
  lineValidations: BasketMergeLineValidation[],
  productIndex: ReturnType<typeof buildPublishedProductIndex>,
  config: ReturnType<typeof readAnonymousBasketConfig>,
): BasketMergePreviewResponse {
  const decisionPayloadHashes = Object.fromEntries(
    BASKET_MERGE_DECISIONS.map((decision) => [
      decision,
      buildBasketMergePayloadHash({
        decision,
        anonymousBasketPublicId: anonymousBasket.basketPublicId,
        accountBasketPublicId: accountBasket.basketPublicId,
        anonymousVersion: anonymousBasket.version,
        accountVersion: accountBasket.version,
      }),
    ]),
  ) as Record<BasketMergeDecision, string>;

  const proposedOutcomes = Object.fromEntries(
    BASKET_MERGE_DECISIONS.map((decision) => {
      const lines = computeDecisionLines(
        decision,
        anonymousBasket,
        accountBasket,
        productIndex,
        config,
      );
      const nextVersion =
        decision === "keep_account"
          ? accountBasket.version
          : accountBasket.version + 1;

      return [
        decision,
        toCustomerBasketResponse(accountBasket, lines, nextVersion),
      ];
    }),
  ) as Record<BasketMergeDecision, CustomerBasketResponse>;

  return {
    contractVersion: BASKET_CONTRACT_VERSION,
    anonymousBasket,
    accountBasket,
    lineValidations,
    availableDecisions: BASKET_MERGE_DECISIONS,
    decisionPayloadHashes,
    proposedOutcomes,
  };
}

export async function previewBasketMerge(
  db: DbClient,
  request: Request,
  sessionToken: string | null,
) {
  const anonSession = await resolveAnonymousBasketSession(db, sessionToken);
  const { anonymousBasket, accountBasket } = await resolveMergeParties(
    db,
    request,
    sessionToken,
  );

  const config = readAnonymousBasketConfig();

  return withTenantContext(db, anonSession.tenantId, async (tx) => {
      const [accountRow] = await tx
        .select({
          menuId: storefrontCustomerBaskets.menuId,
          locationId: storefrontCustomerBaskets.locationId,
          tenantId: storefrontCustomerBaskets.tenantId,
        })
        .from(storefrontCustomerBaskets)
        .where(
          and(
            eq(
              storefrontCustomerBaskets.publicId,
              accountBasket.basketPublicId,
            ),
          ),
        )
        .limit(1);

      if (!accountRow) {
        throw new BasketMergeError("Account basket not found.", 404);
      }

      const snapshot = await loadPublishedMenuSnapshot(
        tx,
        accountRow.tenantId,
        accountRow.menuId,
        accountRow.locationId,
      );
      const productIndex = buildPublishedProductIndex(snapshot);
      const lineValidations = validateMergeLines(
        anonymousBasket,
        accountBasket,
        productIndex,
        config,
      );

      return buildPreviewResponse(
        anonymousBasket,
        accountBasket,
        lineValidations,
        productIndex,
        config,
      );
    },
  );
}

async function retireAnonymousBasketInTx(
  tx: DbClient,
  tenantId: string,
  sessionId: string,
  basketId: string,
) {
  await tx
    .update(storefrontAnonymousSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(storefrontAnonymousSessions.tenantId, tenantId),
        eq(storefrontAnonymousSessions.id, sessionId),
      ),
    );

  await tx
    .update(storefrontAnonymousBaskets)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(storefrontAnonymousBaskets.tenantId, tenantId),
        eq(storefrontAnonymousBaskets.id, basketId),
      ),
    );
}

async function applyMergeDecision(
  tx: DbClient,
  tenantId: string,
  accountBasketId: string,
  customerUserId: string,
  decision: BasketMergeDecision,
  proposedLines: BasketLineResponse[],
  menuId: string,
  locationId: string,
) {
  const [basket] = await tx
    .select()
    .from(storefrontCustomerBaskets)
    .where(
      and(
        eq(storefrontCustomerBaskets.tenantId, tenantId),
        eq(storefrontCustomerBaskets.id, accountBasketId),
        eq(storefrontCustomerBaskets.customerUserId, customerUserId),
      ),
    )
    .limit(1);

  if (!basket) {
    throw new BasketMergeError("Account basket not found.", 404);
  }

  if (decision !== "keep_account") {
    await tx
      .delete(storefrontCustomerBasketLines)
      .where(
        and(
          eq(storefrontCustomerBasketLines.tenantId, tenantId),
          eq(storefrontCustomerBasketLines.basketId, accountBasketId),
        ),
      );

    const snapshot = await loadPublishedMenuSnapshot(
      tx,
      tenantId,
      menuId,
      locationId,
    );
    const productIndex = buildPublishedProductIndex(snapshot);

    for (const [index, line] of proposedLines.entries()) {
      const product = productIndex.get(line.productPublicId);
      if (!product) {
        throw new BasketMergeError(
          "Product is not available on the published menu.",
          400,
          "productPublicId",
        );
      }

      await tx.insert(storefrontCustomerBasketLines).values({
        tenantId,
        basketId: accountBasketId,
        publicId: generateLinePublicId(),
        productPublicId: line.productPublicId,
        quantity: line.quantity,
        unitAmountMinor: product.price.amountMinor,
        unitCurrency: product.price.currency,
        sortOrder: index,
      });
    }

    await tx
      .update(storefrontCustomerBaskets)
      .set({
        version: basket.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(storefrontCustomerBaskets.id, accountBasketId));
  }
}

async function readReplayableMergeOperation(
  db: DbClient,
  tenantId: string,
  customerUserId: string,
  operationId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [existingOperation] = await tx
      .select({ responseSnapshot: storefrontBasketMergeOperations.responseSnapshot })
      .from(storefrontBasketMergeOperations)
      .where(
        and(
          eq(storefrontBasketMergeOperations.tenantId, tenantId),
          eq(storefrontBasketMergeOperations.customerUserId, customerUserId),
          eq(storefrontBasketMergeOperations.operationId, operationId),
        ),
      )
      .limit(1);

    return (existingOperation?.responseSnapshot as
      | BasketMergeCommitResponse
      | undefined) ?? null;
  });
}

async function resolveReplayTenantId(
  db: DbClient,
  sessionToken: string | null,
  replayContext?: { storefrontPublicId: string; locationPublicId: string },
) {
  if (sessionToken?.trim()) {
    try {
      const anonSession = await resolveAnonymousBasketSession(db, sessionToken);
      return anonSession.tenantId;
    } catch {
      // Anonymous session may already be retired after a successful merge.
    }
  }

  if (!replayContext?.storefrontPublicId?.trim()) {
    return null;
  }

  const [storefront] = await db
    .select({ tenantId: storefronts.tenantId })
    .from(storefronts)
    .where(eq(storefronts.publicId, replayContext.storefrontPublicId.trim()))
    .limit(1);

  return storefront?.tenantId ?? null;
}

export async function commitBasketMerge(
  db: DbClient,
  request: Request,
  sessionToken: string | null,
  input: {
    decision: unknown;
    operationId: unknown;
    payloadHash: unknown;
    anonymousExpectedVersion: unknown;
    accountExpectedVersion: unknown;
  },
  replayContext?: { storefrontPublicId: string; locationPublicId: string },
) {
  const decision = parseMergeDecision(input.decision);

  if (typeof input.operationId !== "string" || !input.operationId.trim()) {
    throw new BasketMergeError("operationId is required.", 400, "operationId");
  }

  if (typeof input.payloadHash !== "string" || !input.payloadHash.trim()) {
    throw new BasketMergeError("payloadHash is required.", 400, "payloadHash");
  }

  const anonymousExpectedVersion = Number(input.anonymousExpectedVersion);
  const accountExpectedVersion = Number(input.accountExpectedVersion);

  if (!Number.isInteger(anonymousExpectedVersion)) {
    throw new BasketMergeError(
      "anonymousExpectedVersion must be an integer.",
      400,
      "anonymousExpectedVersion",
    );
  }

  if (!Number.isInteger(accountExpectedVersion)) {
    throw new BasketMergeError(
      "accountExpectedVersion must be an integer.",
      400,
      "accountExpectedVersion",
    );
  }

  const customerSession = await requireVerifiedCustomerSession(request);
  const operationId = input.operationId.trim();
  const replayTenantId = await resolveReplayTenantId(
    db,
    sessionToken,
    replayContext,
  );

  if (replayTenantId) {
    const replay = await readReplayableMergeOperation(
      db,
      replayTenantId,
      customerSession.user.id,
      operationId,
    );
    if (replay) {
      return replay;
    }
  }

  const anonSession = await resolveAnonymousBasketSession(db, sessionToken);
  assertCsrfProtection(request, anonSession.csrfToken);

  const { anonymousBasket, accountBasket } = await resolveMergeParties(
    db,
    request,
    sessionToken,
  );

  if (anonymousBasket.version !== anonymousExpectedVersion) {
    throw new BasketMergeError(
      "Anonymous basket version conflict. Reload the merge preview and retry.",
      409,
      "anonymousExpectedVersion",
    );
  }

  if (accountBasket.version !== accountExpectedVersion) {
    throw new BasketMergeError(
      "Account basket version conflict. Reload the merge preview and retry.",
      409,
      "accountExpectedVersion",
    );
  }

  const expectedPayloadHash = buildBasketMergePayloadHash({
    decision,
    anonymousBasketPublicId: anonymousBasket.basketPublicId,
    accountBasketPublicId: accountBasket.basketPublicId,
    anonymousVersion: anonymousBasket.version,
    accountVersion: accountBasket.version,
  });

  if (input.payloadHash !== expectedPayloadHash) {
    throw new BasketMergeError(
      "payloadHash does not match the current preview.",
      409,
      "payloadHash",
    );
  }

  const config = readAnonymousBasketConfig();

  return withTenantContext(db, anonSession.tenantId, async (tx) => {
    const [accountRow] = await tx
      .select()
      .from(storefrontCustomerBaskets)
      .where(
        and(
          eq(storefrontCustomerBaskets.tenantId, anonSession.tenantId),
          eq(
            storefrontCustomerBaskets.publicId,
            accountBasket.basketPublicId,
          ),
          eq(storefrontCustomerBaskets.customerUserId, customerSession.user.id),
        ),
      )
      .limit(1);

    if (!accountRow) {
      throw new BasketMergeError("Account basket not found.", 404);
    }

    const snapshot = await loadPublishedMenuSnapshot(
      tx,
      anonSession.tenantId,
      accountRow.menuId,
      accountRow.locationId,
    );
    const productIndex = buildPublishedProductIndex(snapshot);
    const lineValidations = validateMergeLines(
      anonymousBasket,
      accountBasket,
      productIndex,
      config,
    );
    const proposedLines = computeDecisionLines(
      decision,
      anonymousBasket,
      accountBasket,
      productIndex,
      config,
    );

    assertCommitAllowed(decision, lineValidations, proposedLines, config);

    await applyMergeDecision(
      tx,
      anonSession.tenantId,
      accountRow.id,
      customerSession.user.id,
      decision,
      proposedLines,
      accountRow.menuId,
      accountRow.locationId,
    );

    await retireAnonymousBasketInTx(
      tx,
      anonSession.tenantId,
      anonSession.sessionId,
      anonSession.basketId,
    );

    const refreshedAccountBasket = await buildCustomerAccountBasketResponse(
      tx,
      anonSession.tenantId,
      accountRow.id,
    );

    const response: BasketMergeCommitResponse = {
      contractVersion: BASKET_CONTRACT_VERSION,
      decision,
      operationId,
      accountBasket: refreshedAccountBasket,
      anonymousBasketRetired: true,
    };

    await tx.insert(storefrontBasketMergeOperations).values({
      tenantId: anonSession.tenantId,
      customerUserId: customerSession.user.id,
      anonymousBasketId: anonSession.basketId,
      accountBasketId: accountRow.id,
      operationId,
      decision,
      payloadHash: expectedPayloadHash,
      anonymousExpectedVersion,
      accountExpectedVersion,
      responseSnapshot: response,
    });

    return response;
  });
}
