import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  storefrontDeployments,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  type StorefrontHostContextResponse,
  HostResolutionError,
  logHostResolutionEvent,
  readHostResolutionTrustFromHeaders,
  resolveStorefrontHostContext,
  resolveTrustedHost,
} from "@/lib/storefront/host-resolution";
import {
  isStorefrontDeploymentBound,
  readStorefrontDeploymentRuntimeConfig,
  type StorefrontDeploymentRuntimeConfig,
} from "@/lib/storefront/storefront-deployment-config";

export class StorefrontDeploymentBindingError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 403, field?: string) {
    super(message);
    this.name = "StorefrontDeploymentBindingError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export type ResolvedStorefrontDeployment = {
  deploymentPublicId: string;
  tenantPublicId: string;
  storefrontPublicId: string;
  environment: string;
  region: string;
  containerAppName: string;
  lifecycleStatus: "provisioning" | "active" | "inactive";
  applicationVersion: string;
  imageRepository: string;
};

export function assertCallerStorefrontMatchesDeploymentBinding(
  callerStorefrontPublicId: string,
  deployment: ResolvedStorefrontDeployment,
) {
  const normalizedCaller = callerStorefrontPublicId.trim();
  if (normalizedCaller !== deployment.storefrontPublicId) {
    throw new StorefrontDeploymentBindingError(
      "Requested storefront does not match this deployment binding.",
      403,
      "storefrontPublicId",
    );
  }
}

export function rejectCallerStorefrontOverrideWhenBound(
  callerStorefrontPublicId: string | null | undefined,
  config: StorefrontDeploymentRuntimeConfig = readStorefrontDeploymentRuntimeConfig(),
) {
  if (!isStorefrontDeploymentBound(config)) {
    return;
  }

  const normalizedCaller = callerStorefrontPublicId?.trim();
  if (
    normalizedCaller &&
    normalizedCaller !== config.boundStorefrontPublicId
  ) {
    throw new StorefrontDeploymentBindingError(
      "Storefront identity cannot be overridden on a bound deployment.",
      403,
      "storefrontPublicId",
    );
  }
}

export async function resolveBoundStorefrontDeployment(
  db: DbClient,
  config: StorefrontDeploymentRuntimeConfig = readStorefrontDeploymentRuntimeConfig(),
): Promise<ResolvedStorefrontDeployment | null> {
  if (!config.boundStorefrontPublicId) {
    return null;
  }

  const [row] = await db
    .select({
      deploymentPublicId: storefrontDeployments.publicId,
      tenantPublicId: tenants.publicId,
      storefrontPublicId: storefronts.publicId,
      environment: storefrontDeployments.environment,
      region: storefrontDeployments.region,
      containerAppName: storefrontDeployments.containerAppName,
      lifecycleStatus: storefrontDeployments.lifecycleStatus,
      applicationVersion: storefrontDeployments.applicationVersion,
      imageRepository: storefrontDeployments.imageRepository,
    })
    .from(storefrontDeployments)
    .innerJoin(
      storefronts,
      and(
        eq(storefronts.tenantId, storefrontDeployments.tenantId),
        eq(storefronts.id, storefrontDeployments.storefrontId),
      ),
    )
    .innerJoin(tenants, eq(tenants.id, storefrontDeployments.tenantId))
    .where(
      and(
        eq(storefronts.publicId, config.boundStorefrontPublicId),
        eq(storefrontDeployments.lifecycleStatus, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new StorefrontDeploymentBindingError(
      "Bound storefront deployment is not configured or not active.",
      503,
      "storefrontPublicId",
    );
  }

  return row;
}

export async function assertHostMatchesDeploymentBinding(
  db: DbClient,
  hostContext: StorefrontHostContextResponse,
  deployment: ResolvedStorefrontDeployment,
  options?: { requestId?: string; hostname?: string },
) {
  if (hostContext.storefrontPublicId !== deployment.storefrontPublicId) {
    logHostResolutionEvent({
      requestId: options?.requestId,
      hostname: options?.hostname ?? hostContext.hostname,
      outcome: "rejected",
      tenantPublicId: hostContext.tenantPublicId,
      storefrontPublicId: hostContext.storefrontPublicId,
      reason: "host_deployment_storefront_mismatch",
    });

    throw new StorefrontDeploymentBindingError(
      "Incoming host does not match this deployment binding.",
      403,
      "host",
    );
  }

  if (hostContext.tenantPublicId !== deployment.tenantPublicId) {
    logHostResolutionEvent({
      requestId: options?.requestId,
      hostname: options?.hostname ?? hostContext.hostname,
      outcome: "rejected",
      tenantPublicId: hostContext.tenantPublicId,
      storefrontPublicId: hostContext.storefrontPublicId,
      reason: "host_deployment_tenant_mismatch",
    });

    throw new StorefrontDeploymentBindingError(
      "Incoming host does not match this deployment binding.",
      403,
      "host",
    );
  }
}

export async function resolveStorefrontHostContextWithDeploymentAgreement(
  db: DbClient,
  hostnameInput: string,
  options?: { requestId?: string },
): Promise<{
  host: StorefrontHostContextResponse;
  deployment: ResolvedStorefrontDeployment | null;
}> {
  const host = await resolveStorefrontHostContext(db, hostnameInput, options);
  const deployment = await resolveBoundStorefrontDeployment(db);

  if (deployment) {
    await assertHostMatchesDeploymentBinding(db, host, deployment, {
      requestId: options?.requestId,
      hostname: hostnameInput,
    });
  }

  return { host, deployment };
}

export async function resolveTrustedHostContextWithDeploymentAgreement(
  db: DbClient,
  headers: Headers,
  options?: { requestId?: string },
) {
  const trust = readHostResolutionTrustFromHeaders(headers);
  const hostname = resolveTrustedHost(trust);
  return resolveStorefrontHostContextWithDeploymentAgreement(db, hostname, {
    requestId: options?.requestId ?? headers.get("x-request-id") ?? undefined,
  });
}

export function tryResolveRequestHostname(headers: Headers) {
  try {
    const trust = readHostResolutionTrustFromHeaders(headers);
    return resolveTrustedHost(trust);
  } catch {
    return null;
  }
}

export async function enforceDeploymentBoundStorefrontPublicId(
  db: DbClient,
  callerStorefrontPublicId: string,
  options?: { requestId?: string; hostname?: string },
) {
  const deployment = await resolveBoundStorefrontDeployment(db);
  if (!deployment) {
    return null;
  }

  assertCallerStorefrontMatchesDeploymentBinding(
    callerStorefrontPublicId,
    deployment,
  );

  if (!options?.hostname?.trim()) {
    throw new StorefrontDeploymentBindingError(
      "Host header is required for deployment-bound requests.",
      403,
      "host",
    );
  }

  const { host } = await resolveStorefrontHostContextWithDeploymentAgreement(
    db,
    options.hostname,
    { requestId: options?.requestId },
  );

  await assertHostMatchesDeploymentBinding(db, host, deployment, options);

  return deployment;
}

export async function enforceDeploymentBoundaryFromRequest(
  db: DbClient,
  request: Request,
  callerStorefrontPublicId: string,
) {
  return enforceDeploymentBoundStorefrontPublicId(db, callerStorefrontPublicId, {
    requestId: request.headers.get("x-request-id") ?? undefined,
    hostname: tryResolveRequestHostname(request.headers) ?? undefined,
  });
}

export function mapStorefrontDeploymentBindingRouteError(error: unknown) {
  if (error instanceof StorefrontDeploymentBindingError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

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
