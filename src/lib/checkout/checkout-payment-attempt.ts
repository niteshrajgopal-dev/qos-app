import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  storefrontCheckoutPaymentAttempts,
  storefrontCheckoutPaymentOperations,
  storefrontCheckoutQuotes,
  locations,
  storefrontCustomerBaskets,
  storefronts,
} from "@/db/schema";
import type { BasketContextInput } from "@/lib/basket/customer-basket";
import {
  CustomerBasketError,
  resolveCustomerAccountBasketContext,
} from "@/lib/basket/customer-basket";
import type { CheckoutQuoteResponse } from "@/lib/checkout/checkout-quote-contract";
import type { CheckoutPaymentAttemptResponse } from "@/lib/checkout/checkout-payment-contract";
import {
  readAllowedCheckoutReturnOrigins,
  readCheckoutPaymentConfig,
  resolveCheckoutRedirectUrls,
} from "@/lib/checkout/payment-config";
import {
  loadPublishedMenuSnapshot,
  resolvePublishedProduct,
} from "@/lib/basket/menu-eligibility";
import { createStripeCheckoutSession } from "@/lib/checkout/stripe-provider";
import { withTenantContext } from "@/lib/tenant/context";

const FORBIDDEN_CLIENT_FIELDS = [
  "amountMinor",
  "currency",
  "liveMode",
  "stripeAccountId",
  "providerAccountId",
  "providerMode",
  "provider",
] as const;

const ACTIVE_PAYMENT_STATUSES = [
  "pending",
  "provider_handoff",
  "unknown",
] as const;

export class CheckoutPaymentError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly lineValidations?: Array<{
    productPublicId: string;
    reason: string;
  }>;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    lineValidations?: CheckoutPaymentError["lineValidations"],
  ) {
    super(message);
    this.name = "CheckoutPaymentError";
    this.statusCode = statusCode;
    this.field = field;
    this.lineValidations = lineValidations;
  }
}

function generatePaymentAttemptPublicId() {
  return `pa_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function buildPaymentRequestHash(input: {
  quotePublicId: string;
  expectedQuoteVersion: number;
  returnUrl: string;
  cancelUrl: string;
}) {
  return createHash("sha256")
    .update(
      `${input.quotePublicId}:${input.expectedQuoteVersion}:${input.returnUrl}:${input.cancelUrl}`,
    )
    .digest("hex");
}

function assertNoForbiddenClientFields(body: Record<string, unknown>) {
  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (field in body && body[field] !== undefined) {
      throw new CheckoutPaymentError(
        `${field} is server-authoritative and must not be supplied by the client.`,
        400,
        field,
      );
    }
  }
}

function parseRelativePath(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CheckoutPaymentError(`${field} is required.`, 400, field);
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    throw new CheckoutPaymentError(
      `${field} must be a same-origin relative path starting with /.`,
      400,
      field,
    );
  }

  return trimmed;
}

export function assertReturnUrlAllowed(returnUrl: string, allowedOrigins: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new CheckoutPaymentError("returnUrl is invalid.", 400, "returnPath");
  }

  if (!allowedOrigins.includes(parsed.origin)) {
    throw new CheckoutPaymentError(
      "returnPath resolves to a disallowed origin.",
      400,
      "returnPath",
    );
  }
}

function buildPaymentAttemptResponse(input: {
  paymentAttemptPublicId: string;
  status: CheckoutPaymentAttemptResponse["status"];
  quote: CheckoutQuoteResponse;
  providerMode: "sandbox" | "fixture";
  handoff: CheckoutPaymentAttemptResponse["handoff"];
}): CheckoutPaymentAttemptResponse {
  return {
    contractVersion: 1,
    paymentAttemptPublicId: input.paymentAttemptPublicId,
    status: input.status,
    quotePublicId: input.quote.quotePublicId,
    quoteVersion: input.quote.version,
    totalMinor: input.quote.totalMinor,
    currency: "AED",
    isTest: true,
    provider: "stripe",
    providerMode: input.providerMode,
    handoff: input.handoff,
  };
}

async function validateQuoteLineEligibility(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  locationId: string,
  quote: CheckoutQuoteResponse,
) {
  const snapshot = await loadPublishedMenuSnapshot(
    tx,
    tenantId,
    menuId,
    locationId,
  );
  const lineValidations: NonNullable<CheckoutPaymentError["lineValidations"]> =
    [];

  for (const line of quote.lines) {
    try {
      resolvePublishedProduct(snapshot, line.productPublicId);
    } catch {
      lineValidations.push({
        productPublicId: line.productPublicId,
        reason: "Product is no longer available for checkout.",
      });
    }
  }

  if (lineValidations.length > 0) {
    throw new CheckoutPaymentError(
      "Quote lines are no longer eligible for checkout.",
      409,
      "lines",
      lineValidations,
    );
  }
}

async function loadExistingPaymentOperation(
  tx: DbClient,
  tenantId: string,
  customerUserId: string,
  operationId: string,
) {
  const [existingOperation] = await tx
    .select({
      requestHash: storefrontCheckoutPaymentOperations.requestHash,
      responseSnapshot: storefrontCheckoutPaymentOperations.responseSnapshot,
    })
    .from(storefrontCheckoutPaymentOperations)
    .where(
      and(
        eq(storefrontCheckoutPaymentOperations.tenantId, tenantId),
        eq(storefrontCheckoutPaymentOperations.customerUserId, customerUserId),
        eq(storefrontCheckoutPaymentOperations.operationId, operationId),
      ),
    )
    .limit(1);

  return existingOperation;
}

export async function createAuthenticatedPaymentAttempt(
  db: DbClient,
  request: Request,
  contextInput: BasketContextInput,
  body: Record<string, unknown>,
) {
  assertNoForbiddenClientFields(body);

  if (typeof body.operationId !== "string" || !body.operationId.trim()) {
    throw new CheckoutPaymentError("operationId is required.", 400, "operationId");
  }

  if (typeof body.quotePublicId !== "string" || !body.quotePublicId.trim()) {
    throw new CheckoutPaymentError(
      "quotePublicId is required.",
      400,
      "quotePublicId",
    );
  }

  if (!Number.isInteger(body.expectedQuoteVersion)) {
    throw new CheckoutPaymentError(
      "expectedQuoteVersion must be an integer.",
      400,
      "expectedQuoteVersion",
    );
  }

  const operationId = body.operationId.trim();
  const quotePublicId = body.quotePublicId.trim();
  const expectedQuoteVersion = body.expectedQuoteVersion as number;
  const returnPath = parseRelativePath(body.returnPath, "returnPath");
  const cancelPath = parseRelativePath(body.cancelPath, "cancelPath");

  const paymentConfig = readCheckoutPaymentConfig();
  const allowedOrigins = readAllowedCheckoutReturnOrigins();
  const { returnUrl, cancelUrl } = resolveCheckoutRedirectUrls(
    paymentConfig,
    returnPath,
    cancelPath,
  );
  assertReturnUrlAllowed(returnUrl, allowedOrigins);
  assertReturnUrlAllowed(cancelUrl, allowedOrigins);

  const requestHash = buildPaymentRequestHash({
    quotePublicId,
    expectedQuoteVersion,
    returnUrl,
    cancelUrl,
  });

  const accountContext = await resolveCustomerAccountBasketContext(
    db,
    request,
    contextInput,
  );

  const replay = await withTenantContext(
    db,
    accountContext.tenantId,
    async (tx) =>
      loadExistingPaymentOperation(
        tx,
        accountContext.tenantId,
        accountContext.customerUserId,
        operationId,
      ),
  );

  if (replay) {
    if (replay.requestHash !== requestHash) {
      throw new CheckoutPaymentError(
        "operationId was already used with a different payment request.",
        409,
        "operationId",
      );
    }

    return replay.responseSnapshot as CheckoutPaymentAttemptResponse;
  }

  const pendingAttempt = await withTenantContext(
    db,
    accountContext.tenantId,
    async (tx) => {
      const [quoteRow] = await tx
        .select()
        .from(storefrontCheckoutQuotes)
        .where(
          and(
            eq(storefrontCheckoutQuotes.tenantId, accountContext.tenantId),
            eq(storefrontCheckoutQuotes.publicId, quotePublicId),
          ),
        )
        .limit(1);

      if (!quoteRow) {
        throw new CheckoutPaymentError("Checkout quote not found.", 404, "quotePublicId");
      }

      if (quoteRow.customerUserId !== accountContext.customerUserId) {
        throw new CheckoutPaymentError(
          "Checkout quote does not belong to the signed-in customer.",
          403,
          "quotePublicId",
        );
      }

      if (!quoteRow.isTest) {
        throw new CheckoutPaymentError(
          "Only test checkout quotes can initiate sandbox payments in Phase 1.",
          403,
          "quotePublicId",
        );
      }

      if (quoteRow.version !== expectedQuoteVersion) {
        throw new CheckoutPaymentError(
          "Quote version conflict. Request a fresh quote and retry.",
          409,
          "expectedQuoteVersion",
        );
      }

      if (quoteRow.expiresAt.getTime() <= Date.now()) {
        throw new CheckoutPaymentError(
          "Checkout quote has expired.",
          409,
          "quotePublicId",
        );
      }

      const [basket] = await tx
        .select()
        .from(storefrontCustomerBaskets)
        .where(
          and(
            eq(storefrontCustomerBaskets.tenantId, accountContext.tenantId),
            eq(storefrontCustomerBaskets.id, quoteRow.basketId),
          ),
        )
        .limit(1);

      if (!basket || basket.status !== "active") {
        throw new CheckoutPaymentError("Basket not found.", 404);
      }

      const [storefront] = await tx
        .select({ publicId: storefronts.publicId })
        .from(storefronts)
        .where(
          and(
            eq(storefronts.tenantId, accountContext.tenantId),
            eq(storefronts.id, basket.storefrontId),
          ),
        )
        .limit(1);

      if (
        !storefront ||
        storefront.publicId !== contextInput.storefrontPublicId.trim()
      ) {
        throw new CheckoutPaymentError(
          "Checkout quote does not belong to the requested storefront.",
          403,
          "storefrontPublicId",
        );
      }

      const [location] = await tx
        .select({ publicId: locations.publicId })
        .from(locations)
        .where(
          and(
            eq(locations.tenantId, accountContext.tenantId),
            eq(locations.id, basket.locationId),
          ),
        )
        .limit(1);

      if (
        !location ||
        location.publicId !== contextInput.locationPublicId.trim()
      ) {
        throw new CheckoutPaymentError(
          "Checkout quote does not belong to the requested location.",
          403,
          "locationPublicId",
        );
      }

      const quote = quoteRow.snapshot as CheckoutQuoteResponse;

      if (quote.totalMinor <= 0) {
        throw new CheckoutPaymentError(
          "Checkout quote total must be greater than zero.",
          400,
          "quotePublicId",
        );
      }

      await validateQuoteLineEligibility(
        tx,
        accountContext.tenantId,
        basket.menuId,
        basket.locationId,
        quote,
      );

      const [conflictingAttempt] = await tx
        .select({ publicId: storefrontCheckoutPaymentAttempts.publicId })
        .from(storefrontCheckoutPaymentAttempts)
        .where(
          and(
            eq(storefrontCheckoutPaymentAttempts.tenantId, accountContext.tenantId),
            eq(storefrontCheckoutPaymentAttempts.quoteId, quoteRow.id),
            inArray(
              storefrontCheckoutPaymentAttempts.status,
              [...ACTIVE_PAYMENT_STATUSES],
            ),
          ),
        )
        .limit(1);

      if (conflictingAttempt) {
        throw new CheckoutPaymentError(
          "An active payment attempt already exists for this quote.",
          409,
          "quotePublicId",
        );
      }

      const paymentAttemptPublicId = generatePaymentAttemptPublicId();
      const providerIdempotencyKey = `${accountContext.tenantId}:${operationId}`;

      const [attemptRow] = await tx
        .insert(storefrontCheckoutPaymentAttempts)
        .values({
          tenantId: accountContext.tenantId,
          customerUserId: accountContext.customerUserId,
          quoteId: quoteRow.id,
          basketId: basket.id,
          publicId: paymentAttemptPublicId,
          status: "pending",
          provider: "stripe",
          providerMode: paymentConfig.stripeSecretKey ? "sandbox" : "fixture",
          amountMinor: quote.totalMinor,
          currency: quote.currency,
          quoteSnapshot: quote,
          providerIdempotencyKey,
          returnUrl,
          cancelUrl,
        })
        .returning({
          id: storefrontCheckoutPaymentAttempts.id,
          publicId: storefrontCheckoutPaymentAttempts.publicId,
        });

      return {
        attemptId: attemptRow.id,
        paymentAttemptPublicId: attemptRow.publicId,
        quote,
        providerIdempotencyKey,
      };
    },
  );

  let providerResult;
  try {
    providerResult = await createStripeCheckoutSession({
      paymentAttemptPublicId: pendingAttempt.paymentAttemptPublicId,
      quotePublicId,
      tenantId: accountContext.tenantId,
      customerUserId: accountContext.customerUserId,
      quote: pendingAttempt.quote,
      returnUrl,
      cancelUrl,
      idempotencyKey: pendingAttempt.providerIdempotencyKey,
    });
  } catch {
    await withTenantContext(db, accountContext.tenantId, async (tx) => {
      await tx
        .update(storefrontCheckoutPaymentAttempts)
        .set({
          status: "unknown",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storefrontCheckoutPaymentAttempts.tenantId, accountContext.tenantId),
            eq(
              storefrontCheckoutPaymentAttempts.publicId,
              pendingAttempt.paymentAttemptPublicId,
            ),
          ),
        );
    });

    const response = buildPaymentAttemptResponse({
      paymentAttemptPublicId: pendingAttempt.paymentAttemptPublicId,
      status: "unknown",
      quote: pendingAttempt.quote,
      providerMode: paymentConfig.stripeSecretKey ? "sandbox" : "fixture",
      handoff: {
        kind: paymentConfig.stripeSecretKey ? "hosted_checkout_url" : "fixture",
        url: returnUrl,
        sessionId: `unknown_${pendingAttempt.paymentAttemptPublicId}`,
        isLabelledFixture: !paymentConfig.stripeSecretKey,
      },
    });

    return persistPaymentOperation(
      db,
      accountContext.tenantId,
      accountContext.customerUserId,
      operationId,
      requestHash,
      pendingAttempt.attemptId,
      response,
    );
  }

  const response = buildPaymentAttemptResponse({
    paymentAttemptPublicId: pendingAttempt.paymentAttemptPublicId,
    status: "provider_handoff",
    quote: pendingAttempt.quote,
    providerMode: providerResult.providerMode,
    handoff: providerResult.handoff,
  });

  await withTenantContext(db, accountContext.tenantId, async (tx) => {
    await tx
      .update(storefrontCheckoutPaymentAttempts)
      .set({
        status: "provider_handoff",
        providerMode: providerResult.providerMode,
        providerReference: providerResult.providerReference,
        handoffSnapshot: providerResult.handoff,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storefrontCheckoutPaymentAttempts.tenantId, accountContext.tenantId),
          eq(
            storefrontCheckoutPaymentAttempts.publicId,
            pendingAttempt.paymentAttemptPublicId,
          ),
        ),
      );
  });

  return persistPaymentOperation(
    db,
    accountContext.tenantId,
    accountContext.customerUserId,
    operationId,
    requestHash,
    pendingAttempt.attemptId,
    response,
  );
}

async function persistPaymentOperation(
  db: DbClient,
  tenantId: string,
  customerUserId: string,
  operationId: string,
  requestHash: string,
  paymentAttemptId: string,
  response: CheckoutPaymentAttemptResponse,
): Promise<CheckoutPaymentAttemptResponse> {
  try {
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.insert(storefrontCheckoutPaymentOperations).values({
        tenantId,
        customerUserId,
        operationId,
        requestHash,
        paymentAttemptId,
        responseSnapshot: response,
      });
    });

    return response;
  } catch {
    const replay = await withTenantContext(db, tenantId, async (tx) =>
      loadExistingPaymentOperation(tx, tenantId, customerUserId, operationId),
    );

    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new CheckoutPaymentError(
          "operationId was already used with a different payment request.",
          409,
          "operationId",
        );
      }

      return replay.responseSnapshot as CheckoutPaymentAttemptResponse;
    }

    throw new CheckoutPaymentError(
      "Payment attempt could not be persisted for idempotent replay.",
      500,
    );
  }
}

export function checkoutPaymentPrivateCacheControl() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}

export { CustomerBasketError };
