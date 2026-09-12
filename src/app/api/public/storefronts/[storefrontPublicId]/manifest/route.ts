import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  mapStorefrontManifestRouteError,
  resolveStorefrontManifestByPublicId,
  storefrontManifestCacheControl,
} from "@/lib/storefront/storefront-manifest-resolver";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ storefrontPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { storefrontPublicId } = await context.params;
    const url = new URL(request.url);
    const contractVersion = url.searchParams.get("contractVersion");

    const manifest = await resolveStorefrontManifestByPublicId(
      db,
      storefrontPublicId,
      contractVersion,
    );

    return NextResponse.json(
      { manifest },
      {
        headers: storefrontManifestCacheControl(manifest.releaseVersion),
      },
    );
  } catch (error) {
    const mapped = mapStorefrontManifestRouteError(error);
    return NextResponse.json(mapped.body, { status: mapped.statusCode });
  }
}
