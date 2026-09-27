import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { ingestProductVideoUpload } from "@/lib/media/product-videos";
import {
  validateVideoUploadBytes,
  VideoUploadValidationError,
} from "@/lib/media/video-upload-validation";

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

    try {
      validateVideoUploadBytes(bytes);
    } catch (error) {
      if (error instanceof VideoUploadValidationError) {
        return NextResponse.json(
          { error: error.message, field: "contentType" },
          { status: 400 },
        );
      }
      throw error;
    }

    const result = await ingestProductVideoUpload(
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
