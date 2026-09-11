import type { CreateTenantHierarchyInput } from "@/lib/tenant/types";

export function quotesTenantFixture(): CreateTenantHierarchyInput {
  return {
    tenant: {
      publicId: "ten_quotes_dev",
      name: "Quotes",
      businessProfile: "hospitality",
      baseCurrency: "AED",
      defaultLocale: "en",
      defaultTimezone: "Asia/Dubai",
    },
    organization: {
      publicId: "org_quotes_default",
      name: "Quotes Organization",
    },
    brand: {
      publicId: "brd_quotes",
      name: "Quotes",
    },
    location: {
      publicId: "loc_quotes_hbz",
      name: "HBZ Stadium",
      slug: "hbz-stadium",
      timezone: "Asia/Dubai",
    },
  };
}

export function flowerTenantFixture(): CreateTenantHierarchyInput {
  return {
    tenant: {
      publicId: "ten_flowers_dev",
      name: "Synthetic Flower Shop",
      businessProfile: "generic_retail",
      baseCurrency: "AED",
      defaultLocale: "en",
      defaultTimezone: "Asia/Dubai",
    },
    organization: {
      publicId: "org_flowers_default",
      name: "Flower Organization",
    },
    brand: {
      publicId: "brd_flowers",
      name: "Flowers",
    },
    location: {
      publicId: "loc_flowers_main",
      name: "Main Shop",
      slug: "main-shop",
      timezone: "Asia/Dubai",
    },
  };
}
