import { NextResponse } from "next/server";

import { db } from "@/db";
import { agentErrorResponse } from "@/lib/agents/http";
import { refreshMenuManagerRun } from "@/lib/agents/menu-manager/menu-manager-service";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string; runPublicId: string }>;
};

/** Returns the run; performs at most one leased provider poll when it is due. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId, runPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const run = await refreshMenuManagerRun(
      db,
      { tenantId, subject: identity.subject, membership },
      { menuPublicId, runPublicId },
    );

    return NextResponse.json({ run }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
