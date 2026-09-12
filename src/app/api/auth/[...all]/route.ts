import { toNextJsHandler } from "better-auth/next-js";

import { getCustomerAuth } from "@/lib/customer/auth-server";

export const dynamic = "force-dynamic";

function getHandler() {
  return toNextJsHandler(getCustomerAuth());
}

export async function GET(request: Request) {
  return getHandler().GET(request);
}

export async function POST(request: Request) {
  return getHandler().POST(request);
}

export async function PATCH(request: Request) {
  return getHandler().PATCH(request);
}

export async function PUT(request: Request) {
  return getHandler().PUT(request);
}

export async function DELETE(request: Request) {
  return getHandler().DELETE(request);
}
