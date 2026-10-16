import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  loadMenuExtractionSource,
  readMenuExtractionPageBytes,
} from "@/lib/catalogue/menu-extraction/source-store";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; sourcePublicId: string; pageNumber: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, sourcePublicId, pageNumber } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);

    const loaded = await loadMenuExtractionSource(db, tenantId, sourcePublicId);
    if (!loaded) {
      return NextResponse.json({ error: "Menu source not found." }, { status: 404 });
    }

    const pageNum = Number.parseInt(pageNumber, 10);
    const page = loaded.pages.find((row) => row.pageNumber === pageNum);
    if (!page) {
      return NextResponse.json({ error: "Page not found." }, { status: 404 });
    }

    const bytes = await readMenuExtractionPageBytes(tenantId, page.storagePath);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
