import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  brands,
  storefrontDomains,
  storefrontReleases,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  readStorefrontEdgeConfig,
  type StorefrontEdgeConfig,
} from "@/lib/storefront/storefront-edge-config";
import { normalizeStorefrontHostname } from "@/lib/storefront/storefronts";
import { withTenantContext } from "@/lib/tenant/context";

export const STOREFRONT_HOST_CONTEXT_CONTRACT_VERSION = 1;

export type StorefrontHostContextResponse = {
  contractVersion: typeof STOREFRONT_HOST_CONTEXT_CONTRACT_VERSION;
  hostname: string;
  tenantPublicId: string;
  storefrontPublicId: string;
  brandPublicId: string;
  brandName: string;
  releasePublicId: string | null;
  releaseVersion: number | null;
  domainType: "platform_subdomain" | "custom_domain";
  domainLifecycleStatus: "provisioning" | "active" | "inactive";
  domainVerificationStatus: "pending" | "verified" | "failed";
};

export class HostResolutionError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 404, field?: string) {
    super(message);
    this.name = "HostResolutionError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export type HostResolutionRequestTrust = {
  hostHeader: string | null;
  forwardedHost: string | null;
  azureFrontDoorId: string | null;
};

type HostResolutionCacheEntry = {
  cacheKey: string;
  context: StorefrontHostContextResponse;
  expiresAt: number;
};

const HOST_RESOLUTION_CACHE_TTL_MS = 60_000;
const hostResolutionCache = new Map<string, HostResolutionCacheEntry>();

export function normalizeIncomingHost(
  host: string,
  allowDevPort = readStorefrontEdgeConfig().allowDevHostPort,
) {
  let value = host.trim().toLowerCase();
  if (value.endsWith(".")) {
    value = value.slice(0, -1);
  }

  const portSeparator = value.lastIndexOf(":");
  if (portSeparator > -1 && !value.includes("]:")) {
    const hostPart = value.slice(0, portSeparator);
    const portPart = value.slice(portSeparator + 1);
    if (/^\d+$/.test(portPart)) {
      if (allowDevPort || portPart === "80" || portPart === "443") {
        value = hostPart;
      }
    }
  }

  return normalizeStorefrontHostname(value);
}

export function resolveTrustedHost(
  trust: HostResolutionRequestTrust,
  config: StorefrontEdgeConfig = readStorefrontEdgeConfig(),
) {
  const forwardedHost = trust.forwardedHost?.trim();
  if (forwardedHost) {
    const configuredFrontDoorId = config.azureFrontDoorId;
    const frontDoorMatches =
      configuredFrontDoorId &&
      trust.azureFrontDoorId?.trim() === configuredFrontDoorId;

    if (!frontDoorMatches && !config.trustForwardedHost) {
      throw new HostResolutionError(
        "Forwarded host is not trusted outside the configured edge boundary.",
        403,
        "host",
      );
    }

    return normalizeIncomingHost(forwardedHost, config.allowDevHostPort);
  }

  if (!trust.hostHeader?.trim()) {
    throw new HostResolutionError("Host header is required.", 400, "host");
  }

  return normalizeIncomingHost(trust.hostHeader, config.allowDevHostPort);
}

export function readHostResolutionTrustFromHeaders(
  headers: Headers,
): HostResolutionRequestTrust {
  return {
    hostHeader: headers.get("host"),
    forwardedHost: headers.get("x-forwarded-host"),
    azureFrontDoorId: headers.get("x-azure-fdid"),
  };
}

export function isStorefrontDomainResolvable(domain: {
  domainType: "platform_subdomain" | "custom_domain";
  verificationStatus: "pending" | "verified" | "failed";
  lifecycleStatus: "provisioning" | "active" | "inactive";
}) {
  if (domain.lifecycleStatus === "inactive") {
    return false;
  }

  if (domain.domainType === "custom_domain") {
    return (
      domain.verificationStatus === "verified" &&
      domain.lifecycleStatus === "active"
    );
  }

  return (
    domain.lifecycleStatus === "active" ||
    domain.lifecycleStatus === "provisioning"
  );
}

function buildHostResolutionCacheKey(input: {
  hostname: string;
  domainUpdatedAt: Date;
  releaseVersion: number | null;
  lifecycleStatus: string;
}) {
  return [
    input.hostname,
    input.domainUpdatedAt.toISOString(),
    input.releaseVersion ?? "none",
    input.lifecycleStatus,
  ].join(":");
}

export function clearHostResolutionCache() {
  hostResolutionCache.clear();
}

export function logHostResolutionEvent(event: {
  requestId?: string;
  hostname: string;
  outcome: "resolved" | "not_configured" | "rejected";
  tenantPublicId?: string;
  storefrontPublicId?: string;
  releasePublicId?: string | null;
  releaseVersion?: number | null;
  reason?: string;
}) {
  console.info(
    JSON.stringify({
      type: "storefront_host_resolution",
      requestId: event.requestId ?? null,
      hostname: event.hostname,
      outcome: event.outcome,
      tenantPublicId: event.tenantPublicId ?? null,
      storefrontPublicId: event.storefrontPublicId ?? null,
      releasePublicId: event.releasePublicId ?? null,
      releaseVersion: event.releaseVersion ?? null,
      reason: event.reason ?? null,
    }),
  );
}

export async function resolveStorefrontHostContext(
  db: DbClient,
  hostnameInput: string,
  options?: { requestId?: string },
): Promise<StorefrontHostContextResponse> {
  const hostname = normalizeIncomingHost(hostnameInput);

  const [domain] = await db
    .select()
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, hostname))
    .limit(1);

  if (!domain || !isStorefrontDomainResolvable(domain)) {
    logHostResolutionEvent({
      requestId: options?.requestId,
      hostname,
      outcome: "not_configured",
      reason: domain ? "domain_not_resolvable" : "domain_not_found",
    });
    throw new HostResolutionError("Storefront host is not configured.", 404);
  }

  return withTenantContext(db, domain.tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        publicId: storefronts.publicId,
        brandId: storefronts.brandId,
        status: storefronts.status,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, domain.tenantId),
          eq(storefronts.id, domain.storefrontId),
        ),
      )
      .limit(1);

    if (!storefront || storefront.status === "archived") {
      logHostResolutionEvent({
        requestId: options?.requestId,
        hostname,
        outcome: "not_configured",
        reason: "storefront_unavailable",
      });
      throw new HostResolutionError("Storefront host is not configured.", 404);
    }

    const [tenant] = await tx
      .select({ publicId: tenants.publicId })
      .from(tenants)
      .where(eq(tenants.id, domain.tenantId))
      .limit(1);

    const [brand] = await tx
      .select({ publicId: brands.publicId, name: brands.name })
      .from(brands)
      .where(and(eq(brands.tenantId, domain.tenantId), eq(brands.id, storefront.brandId)))
      .limit(1);

    if (!tenant || !brand) {
      logHostResolutionEvent({
        requestId: options?.requestId,
        hostname,
        outcome: "not_configured",
        reason: "tenant_or_brand_missing",
      });
      throw new HostResolutionError("Storefront host is not configured.", 404);
    }

    let releasePublicId: string | null = null;
    let releaseVersion: number | null = null;

    if (storefront.activeReleaseId) {
      const [release] = await tx
        .select({
          publicId: storefrontReleases.publicId,
          releaseVersion: storefrontReleases.releaseVersion,
        })
        .from(storefrontReleases)
        .where(
          and(
            eq(storefrontReleases.tenantId, domain.tenantId),
            eq(storefrontReleases.id, storefront.activeReleaseId),
          ),
        )
        .limit(1);

      releasePublicId = release?.publicId ?? null;
      releaseVersion = release?.releaseVersion ?? null;
    }

    const cacheKey = buildHostResolutionCacheKey({
      hostname,
      domainUpdatedAt: domain.updatedAt,
      releaseVersion,
      lifecycleStatus: domain.lifecycleStatus,
    });

    const cached = hostResolutionCache.get(hostname);
    if (cached && cached.cacheKey === cacheKey && cached.expiresAt > Date.now()) {
      return cached.context;
    }

    const context: StorefrontHostContextResponse = {
      contractVersion: STOREFRONT_HOST_CONTEXT_CONTRACT_VERSION,
      hostname: domain.hostname,
      tenantPublicId: tenant.publicId,
      storefrontPublicId: storefront.publicId,
      brandPublicId: brand.publicId,
      brandName: brand.name,
      releasePublicId,
      releaseVersion,
      domainType: domain.domainType,
      domainLifecycleStatus: domain.lifecycleStatus,
      domainVerificationStatus: domain.verificationStatus,
    };

    hostResolutionCache.set(hostname, {
      cacheKey,
      context,
      expiresAt: Date.now() + HOST_RESOLUTION_CACHE_TTL_MS,
    });

    logHostResolutionEvent({
      requestId: options?.requestId,
      hostname,
      outcome: "resolved",
      tenantPublicId: tenant.publicId,
      storefrontPublicId: storefront.publicId,
      releasePublicId,
      releaseVersion,
    });

    return context;
  });
}

export function mapHostResolutionRouteError(error: unknown) {
  if (error instanceof HostResolutionError) {
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

export function hostResolutionCacheControl(releaseVersion: number | null) {
  return {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    Vary: "Host",
    ETag: `"host-context-${releaseVersion ?? "draft"}"`,
  };
}
