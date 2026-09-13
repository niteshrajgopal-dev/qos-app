import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  describeCheckoutPaymentConfig,
  readCheckoutPaymentConfig,
} from "@/lib/checkout/payment-config";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";
import {
  getStaffAnalytics,
  getStaffSettings,
  listStaffCustomers,
  listStaffOrders,
  staffStripeIntegrationView,
} from "@/lib/staff/workspace";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);

    const section = new URL(request.url).searchParams.get("section");

    if (section === "orders") {
      return NextResponse.json({ orders: await listStaffOrders(db, tenantId) });
    }

    if (section === "customers") {
      return NextResponse.json({
        customers: await listStaffCustomers(db, tenantId),
      });
    }

    if (section === "integrations") {
      return NextResponse.json({
        integrations: [
          staffStripeIntegrationView(
            describeCheckoutPaymentConfig(readCheckoutPaymentConfig()),
          ),
        ],
      });
    }

    if (section === "analytics") {
      return NextResponse.json({
        analytics: await getStaffAnalytics(db, tenantId),
      });
    }

    if (section === "settings") {
      const settings = await getStaffSettings(db, tenantId);
      if (!settings) {
        return NextResponse.json({ error: "Business not found." }, { status: 404 });
      }

      return NextResponse.json({ settings });
    }

    return NextResponse.json({ error: "Unknown workspace section." }, { status: 400 });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
