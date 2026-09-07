export type HealthStatus = "healthy" | "unhealthy" | "alive";

export type HealthPayload = {
  status: HealthStatus;
  service: "qos-api";
  version: string;
  database?: "connected" | "disconnected";
  uptimeSeconds: number;
  responseTimeMs: number;
  timestamp: string;
};

type HealthBase = {
  version: string;
  startedAt?: number;
};

function basePayload({ version, startedAt = Date.now() }: HealthBase) {
  return {
    service: "qos-api" as const,
    version,
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

export function healthyPayload(input: HealthBase): HealthPayload {
  return {
    status: "healthy",
    database: "connected",
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
