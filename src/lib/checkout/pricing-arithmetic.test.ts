import { describe, expect, it } from "vitest";

import {
  calculateCheckoutPricing,
  CheckoutPricingError,
} from "@/lib/checkout/pricing-arithmetic";
import {
  PHASE1_SYNTHETIC_COUPON_FIXTURES,
  ROUNDING_BOUNDARY_BASKET,
  STANDARD_THREE_LINE_BASKET,
} from "@/lib/checkout/pricing-fixtures";
import { PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY } from "@/lib/checkout/pricing-policy";

const policy = PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY;
const coupons = PHASE1_SYNTHETIC_COUPON_FIXTURES;
const quotedAt = new Date("2026-06-01T12:00:00.000Z");

describe("checkout pricing arithmetic — synthetic policy v1", () => {
  it("example 1: normal basket without coupon", () => {
    const result = calculateCheckoutPricing({
      lines: STANDARD_THREE_LINE_BASKET,
      policy,
      quotedAt,
    });

    expect(result).toMatchObject({
      merchandiseSubtotalMinor: 5600,
      discountMinor: 0,
      serviceFeeMinor: 200,
      deliveryFeeMinor: 0,
      taxableAmountMinor: 5800,
      vatMinor: 290,
      totalMinor: 6090,
    });
  });

  it("example 2: eligible percent coupon SAVE10", () => {
    const result = calculateCheckoutPricing({
      lines: STANDARD_THREE_LINE_BASKET,
      policy,
      couponCode: "save10",
      couponFixtures: coupons,
      quotedAt,
    });

    expect(result).toMatchObject({
      merchandiseSubtotalMinor: 5600,
      discountMinor: 560,
      serviceFeeMinor: 200,
      taxableAmountMinor: 5240,
      vatMinor: 262,
      totalMinor: 5502,
      couponCode: "SAVE10",
    });
  });

  it("example 3: rejects expired coupon EXPIRED10", () => {
    expect(() =>
      calculateCheckoutPricing({
        lines: STANDARD_THREE_LINE_BASKET,
        policy,
        couponCode: "EXPIRED10",
        couponFixtures: coupons,
        quotedAt,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CheckoutPricingError>>({
        reason: "coupon_expired",
        field: "couponCode",
      }),
    );
  });

  it("example 3b: rejects coupon below minimum spend", () => {
    expect(() =>
      calculateCheckoutPricing({
        lines: STANDARD_THREE_LINE_BASKET,
        policy,
        couponCode: "MINSPEND",
        couponFixtures: coupons,
        quotedAt,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CheckoutPricingError>>({
        reason: "min_spend_not_met",
        field: "couponCode",
      }),
    );
  });

  it("example 4: fixed coupon AED5OFF with service fee and VAT", () => {
    const result = calculateCheckoutPricing({
      lines: STANDARD_THREE_LINE_BASKET,
      policy,
      couponCode: "AED5OFF",
      couponFixtures: coupons,
      quotedAt,
    });

    expect(result).toMatchObject({
      merchandiseSubtotalMinor: 5600,
      discountMinor: 500,
      serviceFeeMinor: 200,
      taxableAmountMinor: 5300,
      vatMinor: 265,
      totalMinor: 5565,
      couponCode: "AED5OFF",
    });
  });

  it("example 5: rounding boundary basket with HALF coupon", () => {
    const result = calculateCheckoutPricing({
      lines: ROUNDING_BOUNDARY_BASKET,
      policy,
      couponCode: "HALF",
      couponFixtures: coupons,
      quotedAt,
    });

    expect(result).toMatchObject({
      merchandiseSubtotalMinor: 3,
      discountMinor: 2,
      serviceFeeMinor: 200,
      taxableAmountMinor: 201,
      vatMinor: 10,
      totalMinor: 211,
    });
  });

  it("caps percent discount at merchandise subtotal", () => {
    const result = calculateCheckoutPricing({
      lines: [{ productPublicId: "prd_small", quantity: 1, unitAmountMinor: 100 }],
      policy,
      couponCode: "AED5OFF",
      couponFixtures: coupons,
      quotedAt,
    });

    expect(result.discountMinor).toBe(100);
    expect(result.totalMinor).toBeGreaterThan(0);
  });

  it("rejects unknown coupon codes explicitly", () => {
    expect(() =>
      calculateCheckoutPricing({
        lines: STANDARD_THREE_LINE_BASKET,
        policy,
        couponCode: "UNKNOWN",
        couponFixtures: coupons,
        quotedAt,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CheckoutPricingError>>({
        reason: "coupon_not_found",
      }),
    );
  });
});
