import { NextResponse } from "next/server";

import { db } from "@/db";
import { rejectMenuAiPhoto } from "@/lib/media/ai-photos/ai-photo-candidates";
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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId, assetPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);

    const candidate = await rejectMenuAiPhoto(
      db,
      { tenantId, subject: identity.subject, membership },
      { menuPublicId, assetPublicId },
    );

    return NextResponse.json({ candidate }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return aiPhotoErrorResponse(error);
  }
}
