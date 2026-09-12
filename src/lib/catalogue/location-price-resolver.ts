export type CentralVariantPrice = {
  amountMinor: number;
  currency: string;
  version: number;
};

export type LocationPriceOverride = {
  amountMinor: number;
  currency: string;
};

export type ResolvedLocationPrice = {
  amountMinor: number;
  currency: string;
  inheritanceMode: "inherited" | "override";
  centralPriceVersion: number;
};

export function resolveLocationVariantPrice(
  central: CentralVariantPrice,
  override: LocationPriceOverride | null,
): ResolvedLocationPrice {
  if (override) {
    if (override.currency !== central.currency) {
      throw new Error("Override currency must match the central price currency.");
    }

    return {
      amountMinor: override.amountMinor,
      currency: override.currency,
      inheritanceMode: "override",
      centralPriceVersion: central.version,
    };
  }

  return {
    amountMinor: central.amountMinor,
    currency: central.currency,
    inheritanceMode: "inherited",
    centralPriceVersion: central.version,
  };
}
