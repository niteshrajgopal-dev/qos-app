import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { acceptMenuAiPhoto } from "@/lib/media/ai-photos/ai-photo-candidates";
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

const acceptBody = z.strictObject({
  accuracyConfirmed: z.boolean(),
  replaceExisting: z.boolean().optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId, assetPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);

    const parsed = acceptBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Send accuracyConfirmed and optional replaceExisting." },
        { status: 400 },
      );
    }

    const candidate = await acceptMenuAiPhoto(
      db,
      { tenantId, subject: identity.subject, membership },
      { menuPublicId, assetPublicId, ...parsed.data },
    );

    return NextResponse.json({ candidate }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return aiPhotoErrorResponse(error);
  }
}
