import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  mapPublicMenuRouteError,
  publicMenuCacheControl,
  resolvePublicMenuByReference,
} from "@/lib/catalogue/public-menu-resolver";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const url = new URL(request.url);
    const locationPublicId = url.searchParams.get("location")?.trim();
    const locale = url.searchParams.get("locale");

    if (!locationPublicId) {
      return NextResponse.json(
        { error: "location query parameter is required.", field: "location" },
        { status: 400 },
      );
    }

    const menu = await resolvePublicMenuByReference(
      db,
      tenantId,
      menuPublicId,
      locationPublicId,
      locale,
    );

    return NextResponse.json(
      { menu },
      {
        headers: publicMenuCacheControl(menu.releaseVersion, menu.locale),
      },
    );
  } catch (error) {
    const mapped = mapPublicMenuRouteError(error);
    return NextResponse.json(mapped.body, { status: mapped.statusCode });
  }
}
