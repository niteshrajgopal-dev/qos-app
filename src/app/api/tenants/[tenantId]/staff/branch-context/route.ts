import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import {
  assertReadableBranch,
  loadBranchContext,
  requireBranchContextMembership,
} from "@/lib/staff/branch-context";
import { BRANCH_SEARCH_PARAM } from "@/lib/staff/branch-selection";
import { staffErrorResponse } from "@/lib/staff/http";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* Branches the caller may work in, from the server's own membership and
   location scope records. A `branch` query parameter is validated against that
   list (403 when it is not permitted); it never widens it. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(
      db,
      tenantId,
      identity.subject,
    );
    const branchContext = await loadBranchContext(db, tenantId, membership);

    const requested = new URL(request.url).searchParams.get(BRANCH_SEARCH_PARAM);
    const body =
      requested === null
        ? branchContext
        : { ...branchContext, selected: assertReadableBranch(requested, branchContext) };

    return NextResponse.json(body, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
