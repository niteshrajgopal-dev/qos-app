import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  hostResolutionCacheControl,
  HostResolutionError,
  mapHostResolutionRouteError,
  readHostResolutionTrustFromHeaders,
  resolveStorefrontHostContext,
  resolveTrustedHost,
} from "@/lib/storefront/host-resolution";

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

    const trust = readHostResolutionTrustFromHeaders(request.headers);
    const hostname = resolveTrustedHost(trust);
    const requestId = request.headers.get("x-request-id") ?? undefined;

    const context = await resolveStorefrontHostContext(db, hostname, {
      requestId,
    });

    return NextResponse.json(
      { host: context },
      {
        headers: hostResolutionCacheControl(context.releaseVersion),
      },
    );
  } catch (error) {
    const mapped = mapHostResolutionRouteError(error);
    return NextResponse.json(mapped.body, { status: mapped.statusCode });
  }
}
