import { describe, expect, it } from "vitest";

import type { StorefrontReleasePayload } from "@/db/schema";
import {
  assertStorefrontManifestIsAllowlisted,
  assertStorefrontPublishedCollectionsCoverLocations,
  findStorefrontPublishedCollection,
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
  locations: [
    { locationPublicId: "loc_quotes_hbz" },
    { locationPublicId: "loc_quotes_al_ain_zoo" },
  ],
  publishedCollections: [
    {
      locationPublicId: "loc_quotes_hbz",
      menuPublicId: "men_hbz_finedine",
      publicMenuKey: "mqr_hbz",
    },
    {
      locationPublicId: "loc_quotes_al_ain_zoo",
      menuPublicId: "men_quotes_demo",
      publicMenuKey: "mqr_zoo",
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
        {
          locationPublicId: "loc_quotes_al_ain_zoo",
          slug: "al-ain-zoo",
          name: "Al Ain Zoo",
        },
      ],
    });

    expect(manifest.contractVersion).toBe(1);
    expect(manifest.brand.name).toBe("Quotes");
    expect(findStorefrontPublishedCollection(manifest, "loc_quotes_hbz")?.publicMenuKey).toBe(
      "mqr_hbz",
    );
    expect(
      findStorefrontPublishedCollection(manifest, "loc_quotes_al_ain_zoo")?.menuPublicId,
    ).toBe("men_quotes_demo");
    expect(() =>
      assertStorefrontPublishedCollectionsCoverLocations(manifest),
    ).not.toThrow();
    expect(() => assertStorefrontManifestIsAllowlisted(manifest)).not.toThrow();
    expect(Object.keys(manifest)).not.toContain("internalName");
  });

  it("resolves publishedCollections by locationPublicId for storefront clients", () => {
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
        {
          locationPublicId: "loc_quotes_al_ain_zoo",
          slug: "al-ain-zoo",
          name: "Al Ain Zoo",
        },
      ],
    });

    expect(findStorefrontPublishedCollection(manifest, "loc_quotes_hbz")).toEqual({
      locationPublicId: "loc_quotes_hbz",
      menuPublicId: "men_hbz_finedine",
      publicMenuKey: "mqr_hbz",
    });
    expect(findStorefrontPublishedCollection(manifest, "loc_quotes_hct")).toBeUndefined();
  });
});
