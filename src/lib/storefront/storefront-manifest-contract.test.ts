import { describe, expect, it } from "vitest";

import type { StorefrontReleasePayload } from "@/db/schema";
import {
  assertStorefrontManifestIsAllowlisted,
  parseStorefrontManifestContractVersion,
  StorefrontManifestContractError,
  toStorefrontManifestResponse,
} from "@/lib/storefront/storefront-manifest-contract";

const payload: StorefrontReleasePayload = {
  storefrontPublicId: "stf_quotes_abc",
  releaseVersion: 2,
  defaultLocale: "en",
  supportedLocales: ["en", "ar"],
  theme: { preset: "hospitality_baseline", colors: { primary: "#111827" } },
  navigation: [{ id: "menu", labelKey: "nav.menu", href: "/" }],
  contentBlocks: [
    { id: "hero", type: "hero", props: { titleKey: "home.hero.title" } },
  ],
  locations: [{ locationPublicId: "loc_quotes_hbz" }],
  publishedCollections: [
    {
      locationPublicId: "loc_quotes_hbz",
      menuPublicId: "men_lunch",
      publicMenuKey: "mqr_test123",
    },
  ],
  featureFlags: { localeSelector: true },
};

describe("storefront manifest contract", () => {
  it("requires an explicit supported contract version", () => {
    expect(() => parseStorefrontManifestContractVersion(null)).toThrow(
      StorefrontManifestContractError,
    );
    expect(parseStorefrontManifestContractVersion("1")).toBe(1);
    expect(() => parseStorefrontManifestContractVersion("99")).toThrow(
      StorefrontManifestContractError,
    );
  });

  it("maps a release payload into an allowlisted manifest", () => {
    const manifest = toStorefrontManifestResponse({
      releasePublicId: "rel_test123",
      tenantPublicId: "ten_quotes_dev",
      brand: { publicId: "brd_quotes", name: "Quotes" },
      primaryHostname: "quotes.dev.qosapp.com",
      payload,
      locations: [
        {
          locationPublicId: "loc_quotes_hbz",
          slug: "hbz-stadium",
          name: "HBZ Stadium",
        },
      ],
    });

    expect(manifest.contractVersion).toBe(1);
    expect(manifest.brand.name).toBe("Quotes");
    expect(manifest.publishedCollections[0]?.publicMenuKey).toBe("mqr_test123");
    expect(() => assertStorefrontManifestIsAllowlisted(manifest)).not.toThrow();
    expect(Object.keys(manifest)).not.toContain("internalName");
  });
});
