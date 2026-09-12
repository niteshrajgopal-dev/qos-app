import { eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { storefrontDomains } from "@/db/schema";
import { slugify } from "@/lib/onboarding/validation";
import { normalizeStorefrontHostname } from "@/lib/storefront/storefronts";

export const DEFAULT_PLATFORM_CUSTOMER_DOMAIN_SUFFIX = "dev.qosapp.com";

export function readPlatformCustomerDomainSuffix(
  source: Record<string, string | undefined> = process.env,
) {
  return (
    source.QOS_PLATFORM_CUSTOMER_DOMAIN_SUFFIX?.trim().toLowerCase() ||
    DEFAULT_PLATFORM_CUSTOMER_DOMAIN_SUFFIX
  );
}

export function derivePlatformHostnameStem(label: string) {
  return slugify(label) || "tenant";
}

export function buildPlatformHostname(stem: string, suffix = readPlatformCustomerDomainSuffix()) {
  return normalizeStorefrontHostname(`${stem}.${suffix}`);
}

export async function reserveUniquePlatformHostname(
  tx: DbClient,
  stem: string,
  suffix = readPlatformCustomerDomainSuffix(),
) {
  let attempt = 0;

  while (attempt < 100) {
    const slugStem = attempt === 0 ? stem : `${stem}-${attempt}`;
    const hostname = buildPlatformHostname(slugStem, suffix);

    const [existing] = await tx
      .select({ id: storefrontDomains.id })
      .from(storefrontDomains)
      .where(eq(storefrontDomains.hostname, hostname))
      .limit(1);

    if (!existing) {
      return {
        hostname,
        slugStem,
        collisionSuffix: attempt === 0 ? null : String(attempt),
      };
    }

    attempt += 1;
  }

  throw new Error("Unable to reserve a unique platform hostname.");
}
