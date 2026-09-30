import { NextResponse } from "next/server";

import { db } from "@/db";
import { agentErrorResponse } from "@/lib/agents/http";
import { getTenantAgentSettings } from "@/lib/agents/tenant-agent-settings";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const agents = await getTenantAgentSettings(db, tenantId, membership);

    return NextResponse.json({ agents }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
