import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  mapPublicMenuRouteError,
  publicMenuCacheControl,
  resolvePublicMenuByKey,
} from "@/lib/catalogue/public-menu-resolver";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ publicKey: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { publicKey } = await context.params;
    const url = new URL(request.url);
    const locale = url.searchParams.get("locale");

    const menu = await resolvePublicMenuByKey(db, publicKey, locale);

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
