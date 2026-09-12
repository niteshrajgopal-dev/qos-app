import { describe, expect, it } from "vitest";

import { resolveLocationVariantPrice } from "@/lib/catalogue/location-price-resolver";

describe("resolveLocationVariantPrice", () => {
  const central = {
    amountMinor: 2000,
    currency: "AED",
    version: 3,
  };

  it("returns the central draft price when no override exists", () => {
    expect(resolveLocationVariantPrice(central, null)).toEqual({
      amountMinor: 2000,
      currency: "AED",
      inheritanceMode: "inherited",
      centralPriceVersion: 3,
    });
  });

  it("returns the explicit override even when it matches the central amount", () => {
    expect(
      resolveLocationVariantPrice(central, {
        amountMinor: 2000,
        currency: "AED",
      }),
    ).toEqual({
      amountMinor: 2000,
      currency: "AED",
      inheritanceMode: "override",
      centralPriceVersion: 3,
    });
  });

  it("keeps the override amount when central draft changes", () => {
    const nextCentral = { ...central, amountMinor: 2200, version: 4 };

    expect(
      resolveLocationVariantPrice(nextCentral, {
        amountMinor: 2400,
        currency: "AED",
      }),
    ).toEqual({
      amountMinor: 2400,
      currency: "AED",
      inheritanceMode: "override",
      centralPriceVersion: 4,
    });
  });
});
