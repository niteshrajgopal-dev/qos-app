import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAppEnv } from "@/lib/env";
import { healthyPayload, unhealthyPayload } from "@/lib/health";
import { readMediaConfig } from "@/lib/media/config";

export async function databaseHealthResponse() {
  const startedAt = Date.now();
  const { serviceVersion } = readAppEnv();

  try {
    const mediaConfig = readMediaConfig();
    await db.execute(sql`SELECT 1`);

    return NextResponse.json(
      healthyPayload({
        version: serviceVersion,
        startedAt,
        mediaStorage: mediaConfig.storageBackend,
      }),
    );
  } catch (error) {
    console.error("Readiness check failed", error);

    return NextResponse.json(
      unhealthyPayload({ version: serviceVersion, startedAt }),
      { status: 503 },
    );
  }
}
