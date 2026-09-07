import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAppEnv } from "@/lib/env";
import { healthyPayload, unhealthyPayload } from "@/lib/health";

export async function databaseHealthResponse() {
  const startedAt = Date.now();
  const { serviceVersion } = readAppEnv();

  try {
    await db.execute(sql`SELECT 1`);

    return NextResponse.json(
      healthyPayload({ version: serviceVersion, startedAt }),
    );
  } catch (error) {
    console.error("Database health check failed", error);

    return NextResponse.json(
      unhealthyPayload({ version: serviceVersion, startedAt }),
      { status: 503 },
    );
  }
}
