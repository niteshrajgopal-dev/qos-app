export const BASKET_CONTRACT_VERSION = 1;

export const SUPPORTED_BASKET_CONTRACT_VERSIONS = [BASKET_CONTRACT_VERSION] as const;

export type BasketLineResponse = {
  linePublicId: string;
  productPublicId: string;
  quantity: number;
  unitPrice: {
    amountMinor: number;
    currency: string;
  };
};

export type AnonymousBasketResponse = {
  contractVersion: typeof BASKET_CONTRACT_VERSION;
  basketPublicId: string;
  version: number;
  tenantPublicId: string;
  storefrontPublicId: string;
  locationPublicId: string;
  menuPublicId: string;
  menuReleaseVersion: number;
  currency: string;
  locale: "en" | "ar";
  lines: BasketLineResponse[];
  itemCount: number;
  provisionalSubtotalMinor: number;
};

export class BasketContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly supportedContractVersions: readonly number[];

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    supportedContractVersions: readonly number[] = SUPPORTED_BASKET_CONTRACT_VERSIONS,
  ) {
    super(message);
    this.name = "BasketContractError";
    this.statusCode = statusCode;
    this.field = field;
    this.supportedContractVersions = supportedContractVersions;
  }
}

export function parseBasketContractVersion(
  value: string | null,
): typeof BASKET_CONTRACT_VERSION {
  if (value === null || value.trim() === "") {
    throw new BasketContractError(
      "contractVersion query parameter is required.",
      400,
      "contractVersion",
    );
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BasketContractError(
      "contractVersion must be an integer.",
      400,
      "contractVersion",
    );
  }

  if (
    !SUPPORTED_BASKET_CONTRACT_VERSIONS.includes(
      parsed as (typeof SUPPORTED_BASKET_CONTRACT_VERSIONS)[number],
    )
  ) {
    throw new BasketContractError(
      `Unsupported basket contract version ${parsed}.`,
      406,
      "contractVersion",
    );
  }

  return parsed as typeof BASKET_CONTRACT_VERSION;
}

export function parseBasketLocale(value: string | null | undefined): "en" | "ar" {
  if (value === "ar") {
    return "ar";
  }

  return "en";
}
