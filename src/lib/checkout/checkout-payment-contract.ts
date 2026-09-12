export const CHECKOUT_PAYMENT_CONTRACT_VERSION = 1;

export type CheckoutPaymentHandoffResponse = {
  kind: "hosted_checkout_url" | "fixture";
  url: string;
  sessionId: string;
  isLabelledFixture: boolean;
};

export type CheckoutPaymentAttemptResponse = {
  contractVersion: typeof CHECKOUT_PAYMENT_CONTRACT_VERSION;
  paymentAttemptPublicId: string;
  status: "provider_handoff" | "pending" | "unknown";
  quotePublicId: string;
  quoteVersion: number;
  totalMinor: number;
  currency: "AED";
  isTest: true;
  provider: "stripe";
  providerMode: "sandbox" | "fixture";
  handoff: CheckoutPaymentHandoffResponse;
};

export class CheckoutPaymentContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CheckoutPaymentContractError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function parseCheckoutPaymentContractVersion(
  value: string | null,
): typeof CHECKOUT_PAYMENT_CONTRACT_VERSION {
  if (value === null || value.trim() === "") {
    throw new CheckoutPaymentContractError(
      "contractVersion query parameter is required.",
      400,
      "contractVersion",
    );
  }

  const parsed = Number(value);
  if (parsed !== CHECKOUT_PAYMENT_CONTRACT_VERSION) {
    throw new CheckoutPaymentContractError(
      `Unsupported checkout payment contract version ${parsed}.`,
      406,
      "contractVersion",
    );
  }

  return CHECKOUT_PAYMENT_CONTRACT_VERSION;
}
