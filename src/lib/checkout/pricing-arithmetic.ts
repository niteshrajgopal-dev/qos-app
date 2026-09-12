import type { CheckoutPricingPolicy } from "@/lib/checkout/pricing-policy";

export type CheckoutPricingLineInput = {
  productPublicId: string;
  quantity: number;
  unitAmountMinor: number;
};

type CheckoutPricingCouponFixtureBase = {
  code: string;
  minSpendMinor?: number;
  validFrom: string;
  validUntil: string;
};

export type CheckoutPricingCouponFixture =
  | (CheckoutPricingCouponFixtureBase & {
      type: "fixed";
      amountMinor: number;
    })
  | (CheckoutPricingCouponFixtureBase & {
      type: "percent";
      percentBps: number;
      maxDiscountMinor?: number;
    });

export type CheckoutCouponRejectionReason =
  | "coupon_not_found"
  | "coupon_expired"
  | "coupon_not_yet_valid"
  | "min_spend_not_met";

export type CheckoutPricingBreakdown = {
  currency: "AED";
  policyVersion: number;
  isTest: true;
  merchandiseSubtotalMinor: number;
  discountMinor: number;
  discountedMerchandiseSubtotalMinor: number;
  serviceFeeMinor: number;
  deliveryFeeMinor: number;
  taxableAmountMinor: number;
  vatMinor: number;
  totalMinor: number;
  couponCode?: string;
};

export class CheckoutPricingError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly reason?: CheckoutCouponRejectionReason;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    reason?: CheckoutCouponRejectionReason,
  ) {
    super(message);
    this.name = "CheckoutPricingError";
    this.statusCode = statusCode;
    this.field = field;
    this.reason = reason;
  }
}

function roundHalfUpMinor(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value >= 0) {
    return Math.round(value);
  }

  return -Math.round(Math.abs(value));
}

function normalizeCouponCode(code: string | null | undefined) {
  return code?.trim().toUpperCase() ?? "";
}

function computeMerchandiseSubtotal(lines: CheckoutPricingLineInput[]) {
  return lines.reduce(
    (total, line) => total + line.quantity * line.unitAmountMinor,
    0,
  );
}

function resolveCoupon(
  couponCode: string | null | undefined,
  fixtures: CheckoutPricingCouponFixture[],
  merchandiseSubtotalMinor: number,
  quotedAt: Date,
) {
  const normalized = normalizeCouponCode(couponCode);
  if (!normalized) {
    return { coupon: null as CheckoutPricingCouponFixture | null, discountMinor: 0 };
  }

  const coupon = fixtures.find(
    (fixture) => normalizeCouponCode(fixture.code) === normalized,
  );

  if (!coupon) {
    throw new CheckoutPricingError(
      "Coupon code is not recognized.",
      400,
      "couponCode",
      "coupon_not_found",
    );
  }

  const validFrom = Date.parse(coupon.validFrom);
  const validUntil = Date.parse(coupon.validUntil);
  const quotedAtMs = quotedAt.getTime();

  if (Number.isFinite(validFrom) && quotedAtMs < validFrom) {
    throw new CheckoutPricingError(
      "Coupon is not yet valid.",
      400,
      "couponCode",
      "coupon_not_yet_valid",
    );
  }

  if (Number.isFinite(validUntil) && quotedAtMs >= validUntil) {
    throw new CheckoutPricingError(
      "Coupon has expired.",
      400,
      "couponCode",
      "coupon_expired",
    );
  }

  if (
    coupon.minSpendMinor !== undefined &&
    merchandiseSubtotalMinor < coupon.minSpendMinor
  ) {
    throw new CheckoutPricingError(
      "Basket does not meet the coupon minimum spend.",
      400,
      "couponCode",
      "min_spend_not_met",
    );
  }

  let discountMinor = 0;

  if (coupon.type === "fixed") {
    const amountMinor = coupon.amountMinor;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new CheckoutPricingError("Coupon fixture is invalid.", 500);
    }

    discountMinor = Math.min(amountMinor, merchandiseSubtotalMinor);
  } else {
    const percentBps = coupon.percentBps;
    if (!Number.isInteger(percentBps) || percentBps <= 0) {
      throw new CheckoutPricingError("Coupon fixture is invalid.", 500);
    }

    discountMinor = roundHalfUpMinor(
      (merchandiseSubtotalMinor * percentBps) / 10_000,
    );

    if (coupon.maxDiscountMinor !== undefined) {
      discountMinor = Math.min(discountMinor, coupon.maxDiscountMinor);
    }

    discountMinor = Math.min(discountMinor, merchandiseSubtotalMinor);
  }

  return { coupon, discountMinor };
}

function computeFeeAmountMinor(
  feePolicy: CheckoutPricingPolicy["serviceFee"] | CheckoutPricingPolicy["deliveryFee"],
  baseMinor: number,
) {
  if (feePolicy.mode === "inactive") {
    return 0;
  }

  if (feePolicy.mode === "fixed") {
    return feePolicy.amountMinor;
  }

  let amount = roundHalfUpMinor((baseMinor * feePolicy.rateBps) / 10_000);

  if (feePolicy.minAmountMinor !== undefined) {
    amount = Math.max(amount, feePolicy.minAmountMinor);
  }

  if (feePolicy.maxAmountMinor !== undefined) {
    amount = Math.min(amount, feePolicy.maxAmountMinor);
  }

  return amount;
}

export function calculateCheckoutPricing(input: {
  lines: CheckoutPricingLineInput[];
  policy: CheckoutPricingPolicy;
  couponCode?: string | null;
  couponFixtures?: CheckoutPricingCouponFixture[];
  quotedAt?: Date;
}): CheckoutPricingBreakdown {
  if (input.lines.length === 0) {
    throw new CheckoutPricingError(
      "At least one basket line is required for pricing.",
      400,
      "lines",
    );
  }

  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new CheckoutPricingError(
        "Line quantity must be a positive integer.",
        400,
        "quantity",
      );
    }

    if (!Number.isInteger(line.unitAmountMinor) || line.unitAmountMinor < 0) {
      throw new CheckoutPricingError(
        "Line unit amount must be a non-negative integer.",
        400,
        "unitAmountMinor",
      );
    }
  }

  const merchandiseSubtotalMinor = computeMerchandiseSubtotal(input.lines);
  const quotedAt = input.quotedAt ?? new Date();
  const { coupon, discountMinor } = resolveCoupon(
    input.couponCode,
    input.couponFixtures ?? [],
    merchandiseSubtotalMinor,
    quotedAt,
  );

  const discountedMerchandiseSubtotalMinor = Math.max(
    0,
    merchandiseSubtotalMinor - discountMinor,
  );

  const serviceFeeMinor = computeFeeAmountMinor(
    input.policy.serviceFee,
    discountedMerchandiseSubtotalMinor,
  );
  const deliveryFeeMinor = computeFeeAmountMinor(
    input.policy.deliveryFee,
    discountedMerchandiseSubtotalMinor,
  );

  const taxableServiceFeeMinor =
    input.policy.serviceFee.mode !== "inactive" && input.policy.serviceFee.taxable
      ? serviceFeeMinor
      : 0;
  const taxableDeliveryFeeMinor =
    input.policy.deliveryFee.mode !== "inactive" &&
    "taxable" in input.policy.deliveryFee &&
    input.policy.deliveryFee.taxable
      ? deliveryFeeMinor
      : 0;

  const taxableAmountMinor =
    discountedMerchandiseSubtotalMinor +
    taxableServiceFeeMinor +
    taxableDeliveryFeeMinor;
  const vatMinor = roundHalfUpMinor(
    (taxableAmountMinor * input.policy.vatRateBps) / 10_000,
  );
  const totalMinor = taxableAmountMinor + vatMinor;

  if (totalMinor < 0) {
    throw new CheckoutPricingError(
      "Pricing calculation produced a negative total.",
      500,
    );
  }

  return {
    currency: "AED",
    policyVersion: input.policy.policyVersion,
    isTest: true,
    merchandiseSubtotalMinor,
    discountMinor,
    discountedMerchandiseSubtotalMinor,
    serviceFeeMinor,
    deliveryFeeMinor,
    taxableAmountMinor,
    vatMinor,
    totalMinor,
    couponCode: coupon ? normalizeCouponCode(coupon.code) : undefined,
  };
}
