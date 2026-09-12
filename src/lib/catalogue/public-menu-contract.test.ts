import { describe, expect, it } from "vitest";

import type { MenuLiveSnapshotPayload } from "@/db/schema";
import {
  assertPublicMenuResponseIsAllowlisted,
  parsePublicMenuLocale,
  toPublicMenuResponse,
} from "@/lib/catalogue/public-menu-contract";

const snapshot: MenuLiveSnapshotPayload = {
  menuPublicId: "men_test_menu",
  locationPublicId: "loc_quotes_hbz",
  version: 3,
  translations: {
    en: { displayName: "HBZ Lunch", description: "English menu" },
    ar: { displayName: "غداء HBZ", description: "قائمة عربية" },
  },
  sections: [
    {
      publicId: "sec_mains",
      sortOrder: 0,
      translations: {
        en: { displayName: "Mains", description: null },
        ar: { displayName: "أطباق", description: null },
      },
      products: [
        {
          productPublicId: "prd_flat_white",
          sortOrder: 0,
          translations: {
            en: { displayName: "Flat White", description: "Coffee" },
            ar: { displayName: "فلات وايت", description: "قهوة" },
          },
          price: {
            amountMinor: 2000,
            currency: "AED",
            inheritanceMode: "inherited",
          },
          mediaAssetId: null,
        },
      ],
    },
  ],
};

describe("public menu contract", () => {
  it("requires an explicit locale parameter", () => {
    expect(() => parsePublicMenuLocale(null)).toThrow(
      "locale query parameter must be explicitly en or ar.",
    );
    expect(parsePublicMenuLocale("en")).toBe("en");
    expect(parsePublicMenuLocale("ar")).toBe("ar");
  });

  it("maps locale-specific menu content without browser fallback", () => {
    const english = toPublicMenuResponse({
      publicKey: "mqr_test",
      tenantPublicId: "ten_quotes_dev",
      locale: "en",
      snapshot,
    });
    const arabic = toPublicMenuResponse({
      publicKey: "mqr_test",
      tenantPublicId: "ten_quotes_dev",
      locale: "ar",
      snapshot,
    });

    expect(english.displayName).toBe("HBZ Lunch");
    expect(arabic.displayName).toBe("غداء HBZ");
    expect(english.sections[0]?.products[0]?.displayName).toBe("Flat White");
    expect(arabic.sections[0]?.products[0]?.displayName).toBe("فلات وايت");
  });

  it("returns an allowlisted public response shape", () => {
    const response = toPublicMenuResponse({
      publicKey: "mqr_test",
      tenantPublicId: "ten_quotes_dev",
      locale: "en",
      snapshot,
    });

    expect(() => assertPublicMenuResponseIsAllowlisted(response)).not.toThrow();
    expect(response.contractVersion).toBe(1);
    expect(response.releaseVersion).toBe(3);
    expect(response.sections[0]?.products[0]?.mediaAssetId).toBeNull();
    expect(Object.keys(response)).not.toContain("internalName");
  });
});
