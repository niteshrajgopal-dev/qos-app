import type { CheckoutQuoteLineResponse } from "@/lib/checkout/checkout-quote-contract";

export const CHECKOUT_PAYMENT_OUTCOME_CONTRACT_VERSION = 1;

export type CheckoutPaymentOutcomeStatus =
  | "pending"
  | "provider_handoff"
  | "unknown"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export type CheckoutPaymentOutcomeMessaging = {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
};

export type CheckoutPaymentOutcomeDiagnostics = {
  lastEventType?: string;
  lastProviderEventId?: string;
  isLabelledFixture?: boolean;
};

export type CheckoutPaymentOutcomeResponse = {
  contractVersion: typeof CHECKOUT_PAYMENT_OUTCOME_CONTRACT_VERSION;
  paymentAttemptPublicId: string;
  status: CheckoutPaymentOutcomeStatus;
  isTest: true;
  provider: "stripe";
  providerMode: "sandbox" | "fixture";
  quotePublicId: string;
  currency: "AED";
  totalMinor: number;
  lines: CheckoutQuoteLineResponse[];
  fees: Array<{
    kind: "service" | "delivery";
    labelEn: string;
    labelAr: string;
    amountMinor: number;
  }>;
  discountMinor: number;
  vatMinor: number;
  providerReference?: string;
  reconciledAt?: string;
  messaging: CheckoutPaymentOutcomeMessaging;
  diagnostics?: CheckoutPaymentOutcomeDiagnostics;
};

export class CheckoutPaymentOutcomeContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CheckoutPaymentOutcomeContractError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function parseCheckoutPaymentOutcomeContractVersion(
  value: string | null,
): typeof CHECKOUT_PAYMENT_OUTCOME_CONTRACT_VERSION {
  if (value === null || value.trim() === "") {
    throw new CheckoutPaymentOutcomeContractError(
      "contractVersion query parameter is required.",
      400,
      "contractVersion",
    );
  }

  const parsed = Number(value);
  if (parsed !== CHECKOUT_PAYMENT_OUTCOME_CONTRACT_VERSION) {
    throw new CheckoutPaymentOutcomeContractError(
      `Unsupported checkout payment outcome contract version ${parsed}.`,
      406,
      "contractVersion",
    );
  }

  return CHECKOUT_PAYMENT_OUTCOME_CONTRACT_VERSION;
}
