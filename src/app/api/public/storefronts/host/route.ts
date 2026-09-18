import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  hostResolutionCacheControl,
  HostResolutionError,
} from "@/lib/storefront/host-resolution";
import {
  mapStorefrontDeploymentBindingRouteError,
  resolveTrustedHostContextWithDeploymentAgreement,
} from "@/lib/storefront/storefront-deployment-binding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    if (
      url.searchParams.has("tenantId") ||
      url.searchParams.has("storefrontId") ||
      url.searchParams.has("tenantPublicId") ||
      url.searchParams.has("storefrontPublicId")
    ) {
      throw new HostResolutionError(
        "Host resolution cannot be overridden by tenant or storefront identifiers.",
        400,
      );
    }

    const { host: context } = await resolveTrustedHostContextWithDeploymentAgreement(
      db,
      request.headers,
      { requestId: request.headers.get("x-request-id") ?? undefined },
    );

    return NextResponse.json(
      { host: context },
      {
        headers: hostResolutionCacheControl(context.releaseVersion),
      },
    );
  } catch (error) {
    const mapped = mapStorefrontDeploymentBindingRouteError(error);
    return NextResponse.json(mapped.body, { status: mapped.statusCode });
  }
}
