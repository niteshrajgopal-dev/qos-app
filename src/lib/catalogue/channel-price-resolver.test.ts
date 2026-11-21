import { describe, expect, it } from "vitest";

import {
  ChannelPriceCurrencyMismatchError,
  resolveBranchAndChannelPrice,
  resolveChannelPrice,
} from "@/lib/catalogue/channel-price-resolver";
import { resolveLocationVariantPrice } from "@/lib/catalogue/location-price-resolver";

const central = { amountMinor: 2000, currency: "AED" };

describe("resolveChannelPrice", () => {
  it("inherits the central amount when the channel has no explicit price", () => {
    expect(resolveChannelPrice(central, null)).toEqual({
      baseAmountMinor: 2000,
      overrideAmountMinor: null,
      effectiveAmountMinor: 2000,
      currency: "AED",
      inheritanceMode: "inherited",
      supportedScope: "channel_list",
      version: null,
    });
  });

  it("uses an explicit channel price, including a genuine zero", () => {
    expect(resolveChannelPrice(central, { amountMinor: 2300, currency: "AED", version: 2 })).toMatchObject({
      baseAmountMinor: 2000,
      overrideAmountMinor: 2300,
      effectiveAmountMinor: 2300,
      inheritanceMode: "override",
      version: 2,
    });

    const zero = resolveChannelPrice(central, { amountMinor: 0, currency: "AED", version: 1 });
    expect(zero.effectiveAmountMinor).toBe(0);
    expect(zero.overrideAmountMinor).toBe(0);
    expect(zero.inheritanceMode).toBe("override");
  });

  it("refuses a channel price in another currency", () => {
    expect(() => resolveChannelPrice(central, { amountMinor: 500, currency: "USD", version: 1 })).toThrow(
      ChannelPriceCurrencyMismatchError,
    );
  });

  it("treats char(3) padding and case as the same currency", () => {
    expect(resolveChannelPrice({ amountMinor: 100, currency: "aed" }, { amountMinor: 50, currency: "AED", version: 1 }).currency).toBe(
      "AED",
    );
  });

  it("resolves each channel only from its own row", () => {
    const overrides = new Map([
      ["schan_a", { amountMinor: 2100, currency: "AED", version: 1 }],
      ["schan_b", { amountMinor: 0, currency: "AED", version: 3 }],
    ]);
    const resolve = (channel: string) => resolveChannelPrice(central, overrides.get(channel) ?? null);

    expect([resolve("schan_a"), resolve("schan_b"), resolve("schan_c")].map((row) => row.effectiveAmountMinor)).toEqual([
      2100, 0, 2000,
    ]);

    overrides.set("schan_a", { amountMinor: 2500, currency: "AED", version: 2 });
    expect(resolve("schan_b").effectiveAmountMinor).toBe(0);
    expect(resolve("schan_c").inheritanceMode).toBe("inherited");

    overrides.delete("schan_b");
    expect(resolve("schan_a").effectiveAmountMinor).toBe(2500);
    expect(resolve("schan_b")).toMatchObject({ effectiveAmountMinor: 2000, inheritanceMode: "inherited" });
  });

  it("leaves the branch override resolver independent of channel prices", () => {
    const branch = resolveLocationVariantPrice({ ...central, version: 4 }, { amountMinor: 2400, currency: "AED" });
    const channel = resolveChannelPrice(central, { amountMinor: 1800, currency: "AED", version: 1 });

    expect(branch).toEqual({ amountMinor: 2400, currency: "AED", inheritanceMode: "override", centralPriceVersion: 4 });
    expect(channel.effectiveAmountMinor).toBe(1800);
    expect(resolveLocationVariantPrice({ ...central, version: 4 }, null).amountMinor).toBe(2000);
  });
});

describe("resolveBranchAndChannelPrice", () => {
  it("is explicitly unsupported and never picks a precedence", () => {
    expect(resolveBranchAndChannelPrice({ locationPublicId: "loc_a", channelPublicId: "schan_a" })).toEqual({
      supported: false,
      reason: "branch_channel_intersection_unsupported",
    });
    expect(Object.keys(resolveBranchAndChannelPrice({ locationPublicId: "loc_b", channelPublicId: "schan_b" }))).not.toContain(
      "amountMinor",
    );
  });
});
