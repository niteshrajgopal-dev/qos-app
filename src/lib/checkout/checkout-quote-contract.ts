export const CHECKOUT_QUOTE_CONTRACT_VERSION = 1;

export type CheckoutQuoteLineResponse = {
  linePublicId: string;
  productPublicId: string;
  displayNameEn: string;
  displayNameAr: string;
  quantity: number;
  unitPrice: {
    amountMinor: number;
    currency: string;
  };
  lineTotalMinor: number;
};

export type CheckoutQuoteFeeResponse = {
  kind: "service" | "delivery";
  labelEn: string;
  labelAr: string;
  amountMinor: number;
};

export type CheckoutQuoteResponse = {
  contractVersion: typeof CHECKOUT_QUOTE_CONTRACT_VERSION;
  quotePublicId: string;
  version: number;
  expiresAt: string;
  isTest: true;
  basketPublicId: string;
  basketVersion: number;
  pricingPolicyVersion: number;
  locale: "en" | "ar";
  currency: "AED";
  lines: CheckoutQuoteLineResponse[];
  couponCode?: string;
  merchandiseSubtotalMinor: number;
  discountMinor: number;
  fees: CheckoutQuoteFeeResponse[];
  vatMinor: number;
  totalMinor: number;
};

export class CheckoutQuoteContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CheckoutQuoteContractError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function parseCheckoutQuoteContractVersion(
  value: string | null,
): typeof CHECKOUT_QUOTE_CONTRACT_VERSION {
  if (value === null || value.trim() === "") {
    throw new CheckoutQuoteContractError(
      "contractVersion query parameter is required.",
      400,
      "contractVersion",
    );
  }

  const parsed = Number(value);
  if (parsed !== CHECKOUT_QUOTE_CONTRACT_VERSION) {
    throw new CheckoutQuoteContractError(
      `Unsupported checkout quote contract version ${parsed}.`,
      406,
      "contractVersion",
    );
  }

  return CHECKOUT_QUOTE_CONTRACT_VERSION;
}
