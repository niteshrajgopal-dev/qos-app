import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  storefrontDomains,
  storefrontLocations,
  storefronts,
} from "@/db/schema";
import { buildPublicId, slugify } from "@/lib/onboarding/validation";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  buildPlatformHostname,
  derivePlatformHostnameStem,
  readPlatformCustomerDomainSuffix,
  reserveUniquePlatformHostname,
} from "@/lib/storefront/platform-domain";
import type { BusinessProfile } from "@/lib/tenant/types";

export type DefaultStorefrontProvisionInput = {
  tenantId: string;
  brandId: string;
  brandName: string;
  businessProfile: BusinessProfile;
  locationId: string;
  locationPublicId: string;
  defaultLocale: string;
  supportedLocales: string[];
};

export type DefaultStorefrontProvisionResult = {
  storefront: {
    id: string;
    publicId: string;
    slug: string;
    status: "draft" | "active" | "archived";
  };
  domain: {
    hostname: string;
    lifecycleStatus: "provisioning" | "active" | "inactive";
    verificationStatus: "pending" | "verified" | "failed";
    collisionSuffix: string | null;
  };
  onboardingStatus: {
    businessReady: true;
    storefrontDraftReady: true;
    platformAddress: {
      hostname: string;
      lifecycleStatus: "provisioning" | "active" | "inactive";
      verificationStatus: "pending" | "verified" | "failed";
    };
    customDomainOptional: true;
  };
  idempotentReplay: boolean;
};

export function deriveDefaultStorefrontSlug(brandName: string) {
  return slugify(brandName) || "primary";
}

export function previewDefaultPlatformHostname(brandName: string) {
  const stem = derivePlatformHostnameStem(brandName);
  return {
    proposedHostname: buildPlatformHostname(stem),
    hostnameStem: stem,
    platformDomainSuffix: readPlatformCustomerDomainSuffix(),
  };
}

export async function provisionDefaultStorefront(
  tx: DbClient,
  input: DefaultStorefrontProvisionInput,
): Promise<DefaultStorefrontProvisionResult> {
  const storefrontSlug = deriveDefaultStorefrontSlug(input.brandName);

  const [existingStorefront] = await tx
    .select()
    .from(storefronts)
    .where(
      and(
        eq(storefronts.tenantId, input.tenantId),
        eq(storefronts.brandId, input.brandId),
        eq(storefronts.slug, storefrontSlug),
      ),
    )
    .limit(1);

  if (existingStorefront) {
    const [domain] = await tx
      .select()
      .from(storefrontDomains)
      .where(
        and(
          eq(storefrontDomains.tenantId, input.tenantId),
          eq(storefrontDomains.storefrontId, existingStorefront.id),
          eq(storefrontDomains.isPrimary, true),
        ),
      )
      .limit(1);

    if (!domain) {
      throw new Error("Default storefront exists without a primary domain.");
    }

    return buildProvisionResult(existingStorefront, domain, true);
  }

  const [storefront] = await tx
    .insert(storefronts)
    .values({
      tenantId: input.tenantId,
      brandId: input.brandId,
      publicId: buildPublicId("stf", input.brandName),
      internalName: `${input.brandName} Website`,
      slug: storefrontSlug,
      status: "draft",
      defaultLocale: input.defaultLocale,
      supportedLocales: input.supportedLocales,
      draftConfig: defaultStorefrontDraftConfig(input.businessProfile),
    })
    .returning();

  await tx.insert(storefrontLocations).values({
    tenantId: input.tenantId,
    storefrontId: storefront.id,
    locationId: input.locationId,
  });

  const hostnameStem = derivePlatformHostnameStem(input.brandName);
  const reservation = await reserveUniquePlatformHostname(tx, hostnameStem);

  const [domain] = await tx
    .insert(storefrontDomains)
    .values({
      tenantId: input.tenantId,
      storefrontId: storefront.id,
      hostname: reservation.hostname,
      domainType: "platform_subdomain",
      verificationStatus: "pending",
      lifecycleStatus: "provisioning",
      isPrimary: true,
    })
    .returning();

  return buildProvisionResult(
    storefront,
    domain,
    false,
    reservation.collisionSuffix,
  );
}

function buildProvisionResult(
  storefront: {
    id: string;
    publicId: string;
    slug: string;
    status: "draft" | "active" | "archived";
  },
  domain: {
    hostname: string;
    lifecycleStatus: "provisioning" | "active" | "inactive";
    verificationStatus: "pending" | "verified" | "failed";
  },
  idempotentReplay: boolean,
  collisionSuffix: string | null = null,
): DefaultStorefrontProvisionResult {
  return {
    storefront: {
      id: storefront.id,
      publicId: storefront.publicId,
      slug: storefront.slug,
      status: storefront.status,
    },
    domain: {
      hostname: domain.hostname,
      lifecycleStatus: domain.lifecycleStatus,
      verificationStatus: domain.verificationStatus,
      collisionSuffix,
    },
    onboardingStatus: {
      businessReady: true,
      storefrontDraftReady: true,
      platformAddress: {
        hostname: domain.hostname,
        lifecycleStatus: domain.lifecycleStatus,
        verificationStatus: domain.verificationStatus,
      },
      customDomainOptional: true,
    },
    idempotentReplay,
  };
}
