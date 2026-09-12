import type { CheckoutPricingCouponFixture } from "@/lib/checkout/pricing-arithmetic";

export type CheckoutPricingLineFixture = {
  productPublicId: string;
  quantity: number;
  unitAmountMinor: number;
};

export const STANDARD_THREE_LINE_BASKET: CheckoutPricingLineFixture[] = [
  { productPublicId: "prd_latte", quantity: 2, unitAmountMinor: 1800 },
  { productPublicId: "prd_croissant", quantity: 1, unitAmountMinor: 2000 },
];

export const ROUNDING_BOUNDARY_BASKET: CheckoutPricingLineFixture[] = [
  { productPublicId: "prd_boundary", quantity: 1, unitAmountMinor: 3 },
];

export const PHASE1_SYNTHETIC_COUPON_FIXTURES: CheckoutPricingCouponFixture[] = [
  {
    code: "SAVE10",
    type: "percent",
    percentBps: 1000,
    minSpendMinor: 5000,
    maxDiscountMinor: 1000,
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  },
  {
    code: "AED5OFF",
    type: "fixed",
    amountMinor: 500,
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  },
  {
    code: "EXPIRED10",
    type: "percent",
    percentBps: 1000,
    validFrom: "2019-01-01T00:00:00.000Z",
    validUntil: "2020-01-01T00:00:00.000Z",
  },
  {
    code: "HALF",
    type: "percent",
    percentBps: 5000,
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  },
  {
    code: "MINSPEND",
    type: "fixed",
    amountMinor: 500,
    minSpendMinor: 10_000,
    validFrom: "2020-01-01T00:00:00.000Z",
    validUntil: "2099-01-01T00:00:00.000Z",
  },
];
