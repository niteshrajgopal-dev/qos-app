import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { resolvePublicMediaDerivative } from "@/lib/media/product-images";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ publicDerivativeId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { publicDerivativeId } = await context.params;

    if (publicDerivativeId.includes("/") || publicDerivativeId.includes("..")) {
      return NextResponse.json({ error: "Media asset not found." }, { status: 404 });
    }

    const media = await resolvePublicMediaDerivative(db, publicDerivativeId);

    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        "Content-Length": String(media.bytes.byteLength),
      },
    });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
