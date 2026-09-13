import { describe, expect, it } from "vitest";

import {
  StorefrontContentBlockValidationError,
  validateStorefrontContentBlocksInput,
} from "@/lib/storefront/storefront-content-blocks-schema";

describe("storefront content block schema", () => {
  const heroBlock = {
    id: "hero",
    type: "hero",
    schemaVersion: 1,
    visible: true,
    props: {
      title: { en: "Welcome", ar: "مرحبا" },
      subtitle: { en: "Fresh coffee daily", ar: "قهوة طازجة يوميا" },
    },
  };

  it("accepts a valid hero block", () => {
    const blocks = validateStorefrontContentBlocksInput([heroBlock], {
      supportedLocales: ["en", "ar"],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("hero");
  });

  it("rejects duplicate block IDs and unsupported fields", () => {
    expect(() =>
      validateStorefrontContentBlocksInput(
        [heroBlock, { ...heroBlock, props: { ...heroBlock.props, price: 100 } }],
        { supportedLocales: ["en", "ar"] },
      ),
    ).toThrow(StorefrontContentBlockValidationError);

    expect(() =>
      validateStorefrontContentBlocksInput(
        [{ ...heroBlock, checkout: true }],
        { supportedLocales: ["en", "ar"] },
      ),
    ).toThrow(StorefrontContentBlockValidationError);
  });

  it("rejects featured item pricing overrides and unsafe links", () => {
    expect(() =>
      validateStorefrontContentBlocksInput(
        [
          {
            id: "featured",
            type: "featured_items",
            schemaVersion: 1,
            visible: true,
            props: {
              title: { en: "Featured", ar: "مميز" },
              productPublicIds: ["prd_latte_001"],
              amountMinor: 1800,
            },
          },
        ],
        { supportedLocales: ["en", "ar"] },
      ),
    ).toThrow(StorefrontContentBlockValidationError);

    expect(() =>
      validateStorefrontContentBlocksInput(
        [
          {
            ...heroBlock,
            props: {
              ...heroBlock.props,
              ctaHref: "javascript:alert(1)",
            },
          },
        ],
        { supportedLocales: ["en", "ar"] },
      ),
    ).toThrow(StorefrontContentBlockValidationError);
  });
});
