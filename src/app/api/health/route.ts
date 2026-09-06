import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await db.execute(sql`SELECT 1`);

    return NextResponse.json(
      {
        status: "healthy",
        service: "qos-api",
        version: process.env.npm_package_version ?? "0.1.0",
        database: "connected",
        uptimeSeconds: Math.floor(process.uptime()),
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";

    return NextResponse.json(
      {
        status: "unhealthy",
        service: "qos-api",
        version: process.env.npm_package_version ?? "0.1.0",
        database: "disconnected",
        error: message,
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
