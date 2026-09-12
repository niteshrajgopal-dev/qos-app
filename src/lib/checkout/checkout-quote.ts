import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  storefrontCheckoutQuoteOperations,
  storefrontCheckoutQuotes,
  storefrontCustomerBasketLines,
  storefrontCustomerBaskets,
} from "@/db/schema";
import { parseBasketLocale } from "@/lib/basket/basket-contract";
import type { BasketContextInput } from "@/lib/basket/customer-basket";
import {
  CustomerBasketError,
  resolveCustomerAccountBasketContext,
} from "@/lib/basket/customer-basket";
import {
  loadPublishedMenuSnapshot,
  resolvePublishedProduct,
} from "@/lib/basket/menu-eligibility";
import type { CheckoutQuoteResponse } from "@/lib/checkout/checkout-quote-contract";
import { readCheckoutQuoteConfig } from "@/lib/checkout/config";
import {
  calculateCheckoutPricing,
  CheckoutPricingError,
} from "@/lib/checkout/pricing-arithmetic";
import { PHASE1_SYNTHETIC_COUPON_FIXTURES } from "@/lib/checkout/pricing-fixtures";
import { PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY } from "@/lib/checkout/pricing-policy";
import { withTenantContext } from "@/lib/tenant/context";

export class CheckoutQuoteError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly priceCorrections?: Array<{
    linePublicId: string;
    productPublicId: string;
    storedUnitAmountMinor: number;
    currentUnitAmountMinor: number;
  }>;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    priceCorrections?: CheckoutQuoteError["priceCorrections"],
  ) {
    super(message);
    this.name = "CheckoutQuoteError";
    this.statusCode = statusCode;
    this.field = field;
    this.priceCorrections = priceCorrections;
  }
}

function generateQuotePublicId() {
  return `qt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function buildQuoteRequestHash(input: {
  basketPublicId: string;
  expectedBasketVersion: number;
  couponCode?: string | null;
  locale: string;
}) {
  const coupon = input.couponCode?.trim().toUpperCase() ?? "";
  return createHash("sha256")
    .update(
      `${input.basketPublicId}:${input.expectedBasketVersion}:${coupon}:${input.locale}`,
    )
    .digest("hex");
}

function buildFeeResponses(
  breakdown: ReturnType<typeof calculateCheckoutPricing>,
) {
  const policy = PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY;
  const fees: CheckoutQuoteResponse["fees"] = [];

  if (policy.serviceFee.mode !== "inactive" && breakdown.serviceFeeMinor > 0) {
    fees.push({
      kind: "service",
      labelEn: policy.serviceFee.labelEn,
      labelAr: policy.serviceFee.labelAr,
      amountMinor: breakdown.serviceFeeMinor,
    });
  }

  if (policy.deliveryFee.mode !== "inactive" && breakdown.deliveryFeeMinor > 0) {
    fees.push({
      kind: "delivery",
      labelEn: policy.deliveryFee.labelEn,
      labelAr: policy.deliveryFee.labelAr,
      amountMinor: breakdown.deliveryFeeMinor,
    });
  }

  return fees;
}

export async function issueAuthenticatedCheckoutQuote(
  db: DbClient,
  request: Request,
  contextInput: BasketContextInput,
  input: {
    expectedBasketVersion?: number;
    couponCode?: string | null;
    operationId?: string;
  },
) {
  if (input.expectedBasketVersion === undefined) {
    throw new CheckoutQuoteError(
      "expectedBasketVersion is required.",
      400,
      "expectedBasketVersion",
    );
  }

  if (!Number.isInteger(input.expectedBasketVersion)) {
    throw new CheckoutQuoteError(
      "expectedBasketVersion must be an integer.",
      400,
      "expectedBasketVersion",
    );
  }

  const locale = parseBasketLocale(contextInput.locale);
  const accountContext = await resolveCustomerAccountBasketContext(
    db,
    request,
    contextInput,
  );
  const config = readCheckoutQuoteConfig();
  const quotedAt = new Date();

  return withTenantContext(db, accountContext.tenantId, async (tx) => {
    const [basket] = await tx
      .select()
      .from(storefrontCustomerBaskets)
      .where(
        and(
          eq(storefrontCustomerBaskets.tenantId, accountContext.tenantId),
          eq(storefrontCustomerBaskets.id, accountContext.basketId),
          eq(
            storefrontCustomerBaskets.customerUserId,
            accountContext.customerUserId,
          ),
        ),
      )
      .limit(1);

    if (!basket || basket.status !== "active") {
      throw new CheckoutQuoteError("Basket not found.", 404);
    }

    if (basket.version !== input.expectedBasketVersion) {
      throw new CheckoutQuoteError(
        "Basket version conflict. Reload the basket and retry.",
        409,
        "expectedBasketVersion",
      );
    }

    const requestHash = buildQuoteRequestHash({
      basketPublicId: basket.publicId,
      expectedBasketVersion: input.expectedBasketVersion,
      couponCode: input.couponCode,
      locale,
    });

    if (input.operationId?.trim()) {
      const [existingOperation] = await tx
        .select({
          requestHash: storefrontCheckoutQuoteOperations.requestHash,
          responseSnapshot: storefrontCheckoutQuoteOperations.responseSnapshot,
        })
        .from(storefrontCheckoutQuoteOperations)
        .where(
          and(
            eq(storefrontCheckoutQuoteOperations.tenantId, accountContext.tenantId),
            eq(
              storefrontCheckoutQuoteOperations.customerUserId,
              accountContext.customerUserId,
            ),
            eq(
              storefrontCheckoutQuoteOperations.operationId,
              input.operationId.trim(),
            ),
          ),
        )
        .limit(1);

      if (existingOperation) {
        if (existingOperation.requestHash !== requestHash) {
          throw new CheckoutQuoteError(
            "operationId was already used with a different quote request.",
            409,
            "operationId",
          );
        }

        return existingOperation.responseSnapshot as CheckoutQuoteResponse;
      }
    }

    const lines = await tx
      .select()
      .from(storefrontCustomerBasketLines)
      .where(
        and(
          eq(storefrontCustomerBasketLines.tenantId, accountContext.tenantId),
          eq(storefrontCustomerBasketLines.basketId, basket.id),
        ),
      )
      .orderBy(asc(storefrontCustomerBasketLines.sortOrder));

    if (lines.length === 0) {
      throw new CheckoutQuoteError(
        "Checkout quote requires at least one basket line.",
        400,
        "lines",
      );
    }

    const snapshot = await loadPublishedMenuSnapshot(
      tx,
      accountContext.tenantId,
      basket.menuId,
      basket.locationId,
    );
    const priceCorrections: NonNullable<CheckoutQuoteError["priceCorrections"]> =
      [];
    const pricingLines = [];
    const quoteLines: CheckoutQuoteResponse["lines"] = [];

    for (const line of lines) {
      const product = resolvePublishedProduct(snapshot, line.productPublicId);
      const currentUnitAmountMinor = product.price.amountMinor;

      if (
        line.unitAmountMinor !== currentUnitAmountMinor ||
        line.unitCurrency !== product.price.currency
      ) {
        priceCorrections.push({
          linePublicId: line.publicId,
          productPublicId: line.productPublicId,
          storedUnitAmountMinor: line.unitAmountMinor,
          currentUnitAmountMinor,
        });
      }

      pricingLines.push({
        productPublicId: line.productPublicId,
        quantity: line.quantity,
        unitAmountMinor: currentUnitAmountMinor,
      });

      const translationEn = product.translations.en?.displayName ?? line.productPublicId;
      const translationAr =
        product.translations.ar?.displayName ?? translationEn;

      quoteLines.push({
        linePublicId: line.publicId,
        productPublicId: line.productPublicId,
        displayNameEn: translationEn,
        displayNameAr: translationAr,
        quantity: line.quantity,
        unitPrice: {
          amountMinor: currentUnitAmountMinor,
          currency: product.price.currency,
        },
        lineTotalMinor: line.quantity * currentUnitAmountMinor,
      });
    }

    if (priceCorrections.length > 0) {
      throw new CheckoutQuoteError(
        "Basket prices changed. Reload the basket before requesting a quote.",
        409,
        "priceCorrections",
        priceCorrections,
      );
    }

    let breakdown;
    try {
      breakdown = calculateCheckoutPricing({
        lines: pricingLines,
        policy: PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY,
        couponCode: input.couponCode,
        couponFixtures: PHASE1_SYNTHETIC_COUPON_FIXTURES,
        quotedAt,
      });
    } catch (error) {
      if (error instanceof CheckoutPricingError) {
        throw error;
      }
      throw error;
    }

    const expiresAt = new Date(quotedAt.getTime() + config.quoteTtlSeconds * 1000);

    const response: CheckoutQuoteResponse = {
      contractVersion: 1,
      quotePublicId: generateQuotePublicId(),
      version: 1,
      expiresAt: expiresAt.toISOString(),
      isTest: true,
      basketPublicId: basket.publicId,
      basketVersion: basket.version,
      pricingPolicyVersion: PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY.policyVersion,
      locale,
      currency: "AED",
      lines: quoteLines,
      couponCode: breakdown.couponCode,
      merchandiseSubtotalMinor: breakdown.merchandiseSubtotalMinor,
      discountMinor: breakdown.discountMinor,
      fees: buildFeeResponses(breakdown),
      vatMinor: breakdown.vatMinor,
      totalMinor: breakdown.totalMinor,
    };

    const [quoteRow] = await tx
      .insert(storefrontCheckoutQuotes)
      .values({
        tenantId: accountContext.tenantId,
        customerUserId: accountContext.customerUserId,
        basketId: basket.id,
        publicId: response.quotePublicId,
        version: response.version,
        basketVersion: basket.version,
        basketPublicId: basket.publicId,
        pricingPolicyVersion: response.pricingPolicyVersion,
        couponCode: breakdown.couponCode ?? null,
        locale,
        currency: response.currency,
        isTest: true,
        expiresAt,
        snapshot: response,
      })
      .returning({ id: storefrontCheckoutQuotes.id });

    if (input.operationId?.trim()) {
      await tx.insert(storefrontCheckoutQuoteOperations).values({
        tenantId: accountContext.tenantId,
        customerUserId: accountContext.customerUserId,
        basketId: basket.id,
        operationId: input.operationId.trim(),
        requestHash,
        quoteId: quoteRow.id,
        responseSnapshot: response,
      });
    }

    return response;
  });
}

export function checkoutQuotePrivateCacheControl() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  };
}

export { CustomerBasketError, CheckoutPricingError };
