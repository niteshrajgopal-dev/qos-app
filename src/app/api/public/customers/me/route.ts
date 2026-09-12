import { NextResponse } from "next/server";

import { db } from "@/db";
import { getCurrentStorefrontCustomer } from "@/lib/customer/association";
import {
  CUSTOMER_CONTRACT_VERSION,
  parseCustomerContractVersion,
} from "@/lib/customer/customer-contract";
import { customerErrorResponse } from "@/lib/customer/http";
import {
  customerPrivateCacheControl,
  requireVerifiedCustomerSession,
} from "@/lib/customer/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    parseCustomerContractVersion(url.searchParams.get("contractVersion"));

    const host =
      url.searchParams.get("host")?.trim() ||
      request.headers.get("x-forwarded-host")?.trim() ||
      request.headers.get("host")?.trim();

    if (!host) {
      return NextResponse.json(
        { error: "host query parameter is required.", field: "host" },
        { status: 400 },
      );
    }

    const session = await requireVerifiedCustomerSession(request);
    const storefrontCustomer = await getCurrentStorefrontCustomer(db, {
      hostname: host,
      customerUserId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: session.user.emailVerified,
    });

    return NextResponse.json(
      {
        customer: {
          contractVersion: CUSTOMER_CONTRACT_VERSION,
          customerUserId: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
          phone: storefrontCustomer.phone,
          tenantPublicId: storefrontCustomer.tenantPublicId,
          storefrontPublicId: storefrontCustomer.storefrontPublicId,
          associationStatus: storefrontCustomer.associationStatus,
        },
      },
      { headers: customerPrivateCacheControl() },
    );
  } catch (error) {
    return customerErrorResponse(error);
  }
}
