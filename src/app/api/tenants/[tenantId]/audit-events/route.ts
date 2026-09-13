import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  listTenantAuditEvents,
  parseAuditEventsQuery,
} from "@/lib/audit/tenant-audit";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireAdministratorMembership(db, tenantId, identity.subject);

    const filters = parseAuditEventsQuery(new URL(request.url).searchParams);
    const page = await listTenantAuditEvents(db, tenantId, filters);

    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("cursor")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (
      error instanceof Error &&
      (error.message.includes("occurredAfter") ||
        error.message.includes("occurredBefore") ||
        error.message.includes("cursorOccurredAt"))
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return staffErrorResponse(error);
  }
}
