import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  brands,
  locations,
  storefrontDomains,
  storefrontReleases,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  parseStorefrontManifestContractVersion,
  toStorefrontManifestResponse,
  type StorefrontManifestResponse,
  StorefrontManifestContractError,
} from "@/lib/storefront/storefront-manifest-contract";
import {
  isStorefrontDomainResolvable,
  normalizeIncomingHost,
} from "@/lib/storefront/host-resolution";
import { withTenantContext } from "@/lib/tenant/context";

export class StorefrontManifestResolverError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 404, field?: string) {
    super(message);
    this.name = "StorefrontManifestResolverError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

async function loadActiveReleaseManifest(
  tx: DbClient,
  tenantId: string,
  storefrontId: string,
  activeReleaseId: string,
  primaryHostname: string,
): Promise<StorefrontManifestResponse> {
  const [tenant] = await tx
    .select({ publicId: tenants.publicId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
  }

  const [storefront] = await tx
    .select({
      publicId: storefronts.publicId,
      brandId: storefronts.brandId,
      status: storefronts.status,
      activeReleaseId: storefronts.activeReleaseId,
    })
    .from(storefronts)
    .where(
      and(eq(storefronts.tenantId, tenantId), eq(storefronts.id, storefrontId)),
    )
    .limit(1);

  if (
    !storefront ||
    storefront.status === "archived" ||
    !storefront.activeReleaseId ||
    storefront.activeReleaseId !== activeReleaseId
  ) {
    throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
  }

  const [release] = await tx
    .select()
    .from(storefrontReleases)
    .where(
      and(
        eq(storefrontReleases.tenantId, tenantId),
        eq(storefrontReleases.id, activeReleaseId),
      ),
    )
    .limit(1);

  if (!release) {
    throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
  }

  const [brand] = await tx
    .select({ publicId: brands.publicId, name: brands.name })
    .from(brands)
    .where(and(eq(brands.tenantId, tenantId), eq(brands.id, storefront.brandId)))
    .limit(1);

  if (!brand) {
    throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
  }

  const locationPublicIds = release.payload.locations.map(
    (entry) => entry.locationPublicId,
  );

  const locationRows =
    locationPublicIds.length === 0
      ? []
      : await tx
          .select({
            publicId: locations.publicId,
            slug: locations.slug,
            name: locations.name,
          })
          .from(locations)
          .where(
            and(
              eq(locations.tenantId, tenantId),
              inArray(locations.publicId, locationPublicIds),
            ),
          );

  const locationByPublicId = new Map(
    locationRows.map((row) => [row.publicId, row]),
  );

  const manifestLocations = release.payload.locations.flatMap((entry) => {
    const location = locationByPublicId.get(entry.locationPublicId);
    if (!location) {
      return [];
    }

    return [
      {
        locationPublicId: location.publicId,
        slug: location.slug,
        name: location.name,
      },
    ];
  });

  return toStorefrontManifestResponse({
    releasePublicId: release.publicId,
    tenantPublicId: tenant.publicId,
    brand,
    primaryHostname,
    payload: release.payload,
    locations: manifestLocations,
  });
}

export async function resolveStorefrontManifestByHostname(
  db: DbClient,
  hostnameInput: string,
  contractVersionInput: string | null,
): Promise<StorefrontManifestResponse> {
  parseStorefrontManifestContractVersion(contractVersionInput);

  const hostname = normalizeIncomingHost(hostnameInput);

  const [domain] = await db
    .select()
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, hostname))
    .limit(1);

  if (!domain || !isStorefrontDomainResolvable(domain)) {
    throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
  }

  return withTenantContext(db, domain.tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        id: storefronts.id,
        activeReleaseId: storefronts.activeReleaseId,
        status: storefronts.status,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, domain.tenantId),
          eq(storefronts.id, domain.storefrontId),
        ),
      )
      .limit(1);

    if (
      !storefront ||
      storefront.status === "archived" ||
      !storefront.activeReleaseId
    ) {
      throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
    }

    return loadActiveReleaseManifest(
      tx,
      domain.tenantId,
      storefront.id,
      storefront.activeReleaseId,
      domain.hostname,
    );
  });
}

export async function resolveStorefrontManifestByPublicId(
  db: DbClient,
  storefrontPublicId: string,
  contractVersionInput: string | null,
): Promise<StorefrontManifestResponse> {
  parseStorefrontManifestContractVersion(contractVersionInput);

  const [storefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.publicId, storefrontPublicId))
    .limit(1);

  if (
    !storefront ||
    storefront.status === "archived" ||
    !storefront.activeReleaseId
  ) {
    throw new StorefrontManifestResolverError("Storefront manifest not found.", 404);
  }

  const activeReleaseId = storefront.activeReleaseId;

  return withTenantContext(db, storefront.tenantId, async (tx) => {
    const [primaryDomain] = await tx
      .select({ hostname: storefrontDomains.hostname })
      .from(storefrontDomains)
      .where(
        and(
          eq(storefrontDomains.tenantId, storefront.tenantId),
          eq(storefrontDomains.storefrontId, storefront.id),
          eq(storefrontDomains.isPrimary, true),
        ),
      )
      .limit(1);

    if (!primaryDomain) {
      throw new StorefrontManifestResolverError(
        "Storefront manifest not found.",
        404,
      );
    }

    return loadActiveReleaseManifest(
      tx,
      storefront.tenantId,
      storefront.id,
      activeReleaseId,
      primaryDomain.hostname,
    );
  });
}

export function mapStorefrontManifestRouteError(error: unknown) {
  if (error instanceof StorefrontManifestContractError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        field: error.field,
        supportedContractVersions: error.supportedContractVersions,
      },
    };
  }

  if (error instanceof StorefrontManifestResolverError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  }

  return {
    statusCode: 500,
    body: { error: "Unexpected error." },
  };
}

export function storefrontManifestCacheControl(releaseVersion: number) {
  return {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    ETag: `"storefront-manifest-${releaseVersion}"`,
  };
}
