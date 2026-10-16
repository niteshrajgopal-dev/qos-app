import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { getLatestDescriptionReview } from "@/lib/catalogue/description-draft/service";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);

    const review = await getLatestDescriptionReview(db, tenantId, productPublicId);
    const gate = evaluateNativeOpenAiGate("catalogue.description", process.env, readAiSpendPolicy());
    return NextResponse.json({
      review,
      gateReady: gate.ready,
      gateReason: gate.ready ? null : gate.reason,
    });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
