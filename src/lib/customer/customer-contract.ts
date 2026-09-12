export const CUSTOMER_CONTRACT_VERSION = 1 as const;

export const SUPPORTED_CUSTOMER_CONTRACT_VERSIONS = [
  CUSTOMER_CONTRACT_VERSION,
] as const;

export class CustomerContractError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly supportedContractVersions: readonly number[];

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    supportedContractVersions: readonly number[] = SUPPORTED_CUSTOMER_CONTRACT_VERSIONS,
  ) {
    super(message);
    this.name = "CustomerContractError";
    this.statusCode = statusCode;
    this.field = field;
    this.supportedContractVersions = supportedContractVersions;
  }
}

export function parseCustomerContractVersion(value: string | null | undefined) {
  if (!value?.trim()) {
    throw new CustomerContractError(
      "contractVersion query parameter is required.",
      400,
      "contractVersion",
    );
  }

  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isInteger(parsed) ||
    !SUPPORTED_CUSTOMER_CONTRACT_VERSIONS.includes(
      parsed as (typeof SUPPORTED_CUSTOMER_CONTRACT_VERSIONS)[number],
    )
  ) {
    throw new CustomerContractError(
      "Unsupported customer contract version.",
      400,
      "contractVersion",
    );
  }

  return parsed;
}

export type CustomerProfileResponse = {
  contractVersion: typeof CUSTOMER_CONTRACT_VERSION;
  customerUserId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  phone: string | null;
  tenantPublicId: string;
  storefrontPublicId: string;
  associationStatus: "active" | "suspended";
};
