export const CHECKOUT_PRICING_POLICY_VERSION = 1 as const;

export type CheckoutPricingPolicyVersion = typeof CHECKOUT_PRICING_POLICY_VERSION;

export type FeeMode = "inactive" | "fixed" | "percent";

export type CheckoutServiceFeePolicy =
  | {
      mode: "inactive";
    }
  | {
      mode: "fixed";
      amountMinor: number;
      taxable: boolean;
      labelEn: string;
      labelAr: string;
    }
  | {
      mode: "percent";
      rateBps: number;
      taxable: boolean;
      minAmountMinor?: number;
      maxAmountMinor?: number;
      labelEn: string;
      labelAr: string;
    };

export type CheckoutDeliveryFeePolicy =
  | {
      mode: "inactive";
    }
  | CheckoutServiceFeePolicy;

export type CheckoutPricingPolicy = {
  policyVersion: CheckoutPricingPolicyVersion;
  currency: "AED";
  isTest: true;
  priceTaxTreatment: "exclusive";
  vatRateBps: number;
  rounding: "half_up_minor";
  couponStacking: "none";
  serviceFee: CheckoutServiceFeePolicy;
  deliveryFee: CheckoutDeliveryFeePolicy;
};

export const PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY: CheckoutPricingPolicy = {
  policyVersion: CHECKOUT_PRICING_POLICY_VERSION,
  currency: "AED",
  isTest: true,
  priceTaxTreatment: "exclusive",
  vatRateBps: 500,
  rounding: "half_up_minor",
  couponStacking: "none",
  serviceFee: {
    mode: "fixed",
    amountMinor: 200,
    taxable: true,
    labelEn: "Service fee",
    labelAr: "رسوم الخدمة",
  },
  deliveryFee: {
    mode: "inactive",
  },
};
