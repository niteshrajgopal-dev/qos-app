import { db } from "@/db";
import { readMenuAiPhotoPreview } from "@/lib/media/ai-photos/ai-photo-candidates";
import { aiPhotoErrorResponse } from "@/lib/media/ai-photos/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string; assetPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId, assetPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const preview = await readMenuAiPhotoPreview(
      db,
      { tenantId, subject: identity.subject, membership },
      { menuPublicId, assetPublicId },
    );

    return new Response(new Uint8Array(preview.bytes), {
      headers: {
        ...staffPrivateCacheControl(),
        "Content-Type": preview.contentType,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (error) {
    return aiPhotoErrorResponse(error);
  }
}
