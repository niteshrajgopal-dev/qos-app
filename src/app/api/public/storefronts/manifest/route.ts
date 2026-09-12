import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  mapStorefrontManifestRouteError,
  resolveStorefrontManifestByHostname,
  storefrontManifestCacheControl,
} from "@/lib/storefront/storefront-manifest-resolver";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get("host")?.trim();
    const contractVersion = url.searchParams.get("contractVersion");

    if (!host) {
      return NextResponse.json(
        { error: "host query parameter is required.", field: "host" },
        { status: 400 },
      );
    }

    const manifest = await resolveStorefrontManifestByHostname(
      db,
      host,
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
