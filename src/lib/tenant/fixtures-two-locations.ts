import type { DbClient } from "@/db/client";
import {
  createTenantHierarchy,
  ensureSeedLocation,
} from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";

export async function createQuotesTwoLocationTenant(db: DbClient) {
  const quotes = await createTenantHierarchy(db, quotesTenantFixture());

  const secondLocation = await ensureSeedLocation(db, {
    tenantId: quotes.tenant.id,
    brandId: quotes.brand.id,
    publicId: "loc_quotes_hct",
    name: "HCT Academic City",
    slug: "hct-academic-city",
    timezone: "Asia/Dubai",
  });

  return {
    ...quotes,
    locations: [quotes.location, secondLocation] as const,
    locationA: quotes.location,
    locationB: secondLocation,
  };
}
