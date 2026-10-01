import { DrizzleQueryError } from "drizzle-orm/errors";
import { NextResponse } from "next/server";

import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { AiPhotoError } from "@/lib/media/ai-photos/ai-photo-candidates";
import { AiPhotoProviderError } from "@/lib/media/ai-photos/provider";
import { ProductMediaError } from "@/lib/media/product-images";

export function aiPhotoErrorResponse(error: unknown) {
  if (error instanceof AiPhotoError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode },
    );
  }

  if (error instanceof AiPhotoProviderError) {
    return NextResponse.json(
      { error: "The image service is unavailable right now.", code: "provider_unavailable" },
      { status: 503 },
    );
  }

  if (error instanceof ProductMediaError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  // Query errors carry SQL text and parameters (tenant ids); keep them in server logs only.
  if (error instanceof DrizzleQueryError) {
    console.error("AI photo request failed", error.cause ?? error);
    return NextResponse.json(
      { error: "AI photos are temporarily unavailable.", code: "ai_photos_storage_error" },
      { status: 500 },
    );
  }

  return catalogueErrorResponse(error);
}
