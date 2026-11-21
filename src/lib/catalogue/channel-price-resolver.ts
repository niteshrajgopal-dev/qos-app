/* Channel price inheritance (QOS-213). This module is the only place that
   decides what a sales-channel price is; services, exports and editors call it.

   Policy:
   - The central variant price and branch (location) overrides are unchanged
     and independent of channel price lists. Storefront, public menu and the
     location-price resolver never call this module.
   - A channel price row, when it exists, is the explicit price for that
     channel identity and currency. The effective price is its amount,
     including 0. With no row, the effective price is the central amount and
     the inheritance mode is "inherited".
   - The only supported scope is "channel_list". A branch-by-channel
     intersection is not supported: resolveBranchAndChannelPrice always says
     so and never picks a winner between a branch override and a channel list.
   - A channel price must use the central (or option) currency. */

export type ChannelPriceScope = "channel_list";

export const SUPPORTED_CHANNEL_PRICE_SCOPE: ChannelPriceScope = "channel_list";

export type ChannelPriceBase = {
  amountMinor: number;
  currency: string;
};

export type ChannelPriceOverride = {
  amountMinor: number;
  currency: string;
  version: number;
};

export type ResolvedChannelPrice = {
  baseAmountMinor: number;
  overrideAmountMinor: number | null;
  effectiveAmountMinor: number;
  currency: string;
  inheritanceMode: "inherited" | "override";
  supportedScope: ChannelPriceScope;
  version: number | null;
};

export class ChannelPriceCurrencyMismatchError extends Error {
  constructor(expected: string, received: string) {
    super(
      `Channel price currency ${received} must match the central price currency ${expected}.`,
    );
    this.name = "ChannelPriceCurrencyMismatchError";
  }
}

export function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase();
}

export function assertChannelPriceCurrency(base: ChannelPriceBase, currency: string) {
  if (normalizeCurrency(currency) !== normalizeCurrency(base.currency)) {
    throw new ChannelPriceCurrencyMismatchError(
      normalizeCurrency(base.currency),
      normalizeCurrency(currency),
    );
  }
}

export function isValidChannelAmountMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function resolveChannelPrice(
  base: ChannelPriceBase,
  override: ChannelPriceOverride | null,
): ResolvedChannelPrice {
  const currency = normalizeCurrency(base.currency);

  if (override) {
    assertChannelPriceCurrency(base, override.currency);
    return {
      baseAmountMinor: base.amountMinor,
      overrideAmountMinor: override.amountMinor,
      effectiveAmountMinor: override.amountMinor,
      currency,
      inheritanceMode: "override",
      supportedScope: SUPPORTED_CHANNEL_PRICE_SCOPE,
      version: override.version,
    };
  }

  return {
    baseAmountMinor: base.amountMinor,
    overrideAmountMinor: null,
    effectiveAmountMinor: base.amountMinor,
    currency,
    inheritanceMode: "inherited",
    supportedScope: SUPPORTED_CHANNEL_PRICE_SCOPE,
    version: null,
  };
}

export type BranchAndChannelPriceResult = {
  supported: false;
  reason: "branch_channel_intersection_unsupported";
};

/**
 * A price for one branch *and* one channel at the same time. QOS has no rule
 * for this (the source workbook only carries channel price lists), so the
 * answer is always "unsupported" and callers must not combine the two.
 */
export function resolveBranchAndChannelPrice(input: {
  locationPublicId: string;
  channelPublicId: string;
}): BranchAndChannelPriceResult {
  void input;
  return { supported: false, reason: "branch_channel_intersection_unsupported" };
}
