import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { agentErrorResponse } from "@/lib/agents/http";
import {
  askMenuManager,
  getLatestMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import { MENU_SNAPSHOT_MAX_PRODUCTS } from "@/lib/catalogue/menu-snapshot";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

const askBody = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(200),
  selectedProductPublicIds: z
    .array(z.string().max(128))
    .max(MENU_SNAPSHOT_MAX_PRODUCTS)
    .optional(),
  acknowledgeUnresolvedRunPublicId: z.string().max(64).optional(),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const run = await getLatestMenuManagerRun(
      db,
      { tenantId, subject: identity.subject, membership },
      menuPublicId,
    );

    return NextResponse.json({ run }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);

    const parsed = askBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Send an idempotencyKey and optional selectedProductPublicIds." },
        { status: 400 },
      );
    }

    const { run, created } = await askMenuManager(
      db,
      { tenantId, subject: identity.subject, membership },
      {
        menuPublicId,
        idempotencyKey: parsed.data.idempotencyKey,
        selectedProductPublicIds: parsed.data.selectedProductPublicIds,
        acknowledgeUnresolvedRunPublicId: parsed.data.acknowledgeUnresolvedRunPublicId,
      },
    );

    return NextResponse.json(
      { run },
      { status: created ? 201 : 200, headers: staffPrivateCacheControl() },
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}
