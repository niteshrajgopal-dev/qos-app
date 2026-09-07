import { NextResponse } from "next/server";

import { readAppEnv } from "@/lib/env";
import { livePayload } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { serviceVersion } = readAppEnv();

  return NextResponse.json(livePayload({ version: serviceVersion }));
}
