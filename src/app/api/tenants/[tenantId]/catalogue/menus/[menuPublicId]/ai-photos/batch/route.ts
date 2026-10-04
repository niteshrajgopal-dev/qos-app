import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { AI_PHOTO_MAX_BATCH, queueMenuAiPhotoBatch } from "@/lib/media/ai-photos/ai-photo-candidates";
import { aiPhotoErrorResponse } from "@/lib/media/ai-photos/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

const batchBody = z.strictObject({
  productPublicIds: z.array(z.string().trim().min(1).max(128)).min(1).max(AI_PHOTO_MAX_BATCH),
});

/** Admits queued AI photo requests; every item reports its own outcome. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);

    const parsed = batchBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Send between 1 and ${AI_PHOTO_MAX_BATCH} productPublicIds.` },
        { status: 400 },
      );
    }

    const result = await queueMenuAiPhotoBatch(
      db,
      { tenantId, subject: identity.subject, membership },
      { menuPublicId, productPublicIds: parsed.data.productPublicIds },
    );
    return NextResponse.json(result, { status: 200, headers: staffPrivateCacheControl() });
  } catch (error) {
    return aiPhotoErrorResponse(error);
  }
}
