import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { ingestProductImageUpload } from "@/lib/media/product-images";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const grantToken = request.headers.get("x-qos-upload-grant")?.trim();

    if (!grantToken) {
      return NextResponse.json(
        { error: "X-QOS-Upload-Grant header is required.", field: "grantToken" },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    const result = await ingestProductImageUpload(
      db,
      tenantId,
      productPublicId,
      grantToken,
      bytes,
    );

    return NextResponse.json({ upload: result });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
