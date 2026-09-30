import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { agentErrorResponse } from "@/lib/agents/http";
import { setTenantAgentBindingEnabled } from "@/lib/agents/tenant-agent-bindings";
import { getTenantAgentSettings } from "@/lib/agents/tenant-agent-settings";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; capability: string }>;
};

const body = z.strictObject({
  enabled: z.boolean(),
  expectedVersion: z.number().int().positive(),
});

/** Administrators turn an approved capability on or off; they cannot choose the agent. */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { tenantId, capability } = await context.params;
    if (capability !== "menu_manager") {
      return NextResponse.json({ error: "Unknown agent capability." }, { status: 404 });
    }

    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Send enabled and expectedVersion." },
        { status: 400 },
      );
    }

    await setTenantAgentBindingEnabled(db, tenantId, identity.subject, capability, parsed.data);
    const agents = await getTenantAgentSettings(db, tenantId, membership);

    return NextResponse.json({ agents }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
