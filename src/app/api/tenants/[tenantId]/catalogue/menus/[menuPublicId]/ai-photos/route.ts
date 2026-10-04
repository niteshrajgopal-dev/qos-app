import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import {
  generateMenuAiPhoto,
  getMenuAiPhotos,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import { aiPhotoErrorResponse } from "@/lib/media/ai-photos/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";
/** One image per request; the provider call is bounded by AI_PHOTO_REQUEST_TIMEOUT_MS. */
export const maxDuration = 200;

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

const generateBody = z.strictObject({
  productPublicId: z.string().trim().min(1).max(128),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const aiPhotos = await getMenuAiPhotos(
      db,
      { tenantId, subject: identity.subject, membership },
      menuPublicId,
    );

    return NextResponse.json({ aiPhotos }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return aiPhotoErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);

    const parsed = generateBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Send a productPublicId." }, { status: 400 });
    }

    const { candidate, created, queued } = await generateMenuAiPhoto(
      db,
      { tenantId, subject: identity.subject, membership },
      { menuPublicId, productPublicId: parsed.data.productPublicId },
    );

    const status = candidate.status === "failed" ? 502 : queued ? 202 : created ? 201 : 200;
    return NextResponse.json({ candidate }, { status, headers: staffPrivateCacheControl() });
  } catch (error) {
    return aiPhotoErrorResponse(error);
  }
}
