import type { MediaStorageBackend } from "@/lib/media/config";

export type HealthStatus = "healthy" | "unhealthy" | "alive";

export type HealthPayload = {
  status: HealthStatus;
  service: "qos-api";
  version: string;
  build: string;
  database?: "connected" | "disconnected";
  mediaStorage?: MediaStorageBackend;
  uptimeSeconds: number;
  responseTimeMs: number;
  timestamp: string;
};

type HealthBase = {
  version: string;
  build?: string;
  startedAt?: number;
  mediaStorage?: MediaStorageBackend;
};

function basePayload({
  version,
  build = "unknown",
  startedAt = Date.now(),
}: HealthBase) {
  return {
    service: "qos-api" as const,
    version,
    build,
    uptimeSeconds: Math.floor(process.uptime()),
    responseTimeMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };
}

export function livePayload(input: HealthBase): HealthPayload {
  return {
    status: "alive",
    ...basePayload(input),
  };
}

export function healthyPayload(
  input: HealthBase & { mediaStorage: MediaStorageBackend },
): HealthPayload {
  return {
    status: "healthy",
    database: "connected",
    mediaStorage: input.mediaStorage,
    ...basePayload(input),
  };
}

export function unhealthyPayload(input: HealthBase): HealthPayload {
  return {
    status: "unhealthy",
    database: "disconnected",
    ...basePayload(input),
  };
}
