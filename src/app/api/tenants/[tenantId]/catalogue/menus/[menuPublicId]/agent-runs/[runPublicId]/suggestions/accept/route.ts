import { NextResponse } from "next/server";

import { db } from "@/db";
import { AgentRunError } from "@/lib/agents/agent-runs";
import { agentErrorResponse } from "@/lib/agents/http";
import {
  acceptMenuManagerSuggestion,
  acceptMenuManagerSuggestionBodySchema,
} from "@/lib/agents/menu-manager/accept-menu-manager-suggestion";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string; runPublicId: string }>;
};

/** Applies one stored suggestion to the product draft. Does not publish. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId, runPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const parsed = acceptMenuManagerSuggestionBodySchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new AgentRunError(
        "invalid_request",
        "Choose one suggestion to apply to the draft.",
        400,
      );
    }

    const accepted = await acceptMenuManagerSuggestion(
      db,
      { tenantId, subject: identity.subject, membership },
      {
        menuPublicId,
        runPublicId,
        productPublicId: parsed.data.productPublicId,
        field: parsed.data.field,
        proposedText: parsed.data.proposedText,
      },
    );

    return NextResponse.json(accepted, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
