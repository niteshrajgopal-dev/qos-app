import { describe, expect, it } from "vitest";

import { aiWorkerReadiness, readAiWorkerConfig } from "@/lib/ai/jobs/ai-worker-config";

const CAPS = {
  AI_WORKER_CONCURRENCY: "2",
  AI_WORKER_MAX_ACTIVE_GLOBAL: "4",
  AI_WORKER_MAX_ACTIVE_PER_TENANT: "1",
  AI_WORKER_MAX_ACTIVE_PER_KIND: "3",
};

describe("AI worker config", () => {
  it("is off and not ready with nothing set, naming every missing setting", () => {
    const config = readAiWorkerConfig({});
    expect(config).toEqual({
      enabled: false,
      concurrency: null,
      maxActiveGlobal: null,
      maxActivePerTenant: null,
      maxActivePerKind: null,
      leaseMs: 60_000,
      pollIntervalMs: 5_000,
    });
    expect(aiWorkerReadiness(config)).toEqual({
      ready: false,
      missing: [
        "AI_WORKER_ENABLED",
        "AI_WORKER_CONCURRENCY",
        "AI_WORKER_MAX_ACTIVE_GLOBAL",
        "AI_WORKER_MAX_ACTIVE_PER_TENANT",
        "AI_WORKER_MAX_ACTIVE_PER_KIND",
      ],
    });
  });

  it("stays not ready when enabled without caps, or with caps but disabled", () => {
    expect(aiWorkerReadiness(readAiWorkerConfig({ AI_WORKER_ENABLED: "true" }))).toMatchObject({ ready: false });
    expect(aiWorkerReadiness(readAiWorkerConfig(CAPS))).toEqual({ ready: false, missing: ["AI_WORKER_ENABLED"] });
  });

  it("is ready only with the flag and every cap", () => {
    expect(aiWorkerReadiness(readAiWorkerConfig({ AI_WORKER_ENABLED: "TRUE", ...CAPS }))).toEqual({
      ready: true,
      limits: { concurrency: 2, maxActiveGlobal: 4, maxActivePerTenant: 1, maxActivePerKind: 3 },
    });
  });

  it.each(["0", "-1", "1.5", "abc", "1001", " "])("treats cap %j as unset", (value) => {
    const config = readAiWorkerConfig({ AI_WORKER_ENABLED: "true", ...CAPS, AI_WORKER_MAX_ACTIVE_GLOBAL: value });
    expect(aiWorkerReadiness(config)).toEqual({ ready: false, missing: ["AI_WORKER_MAX_ACTIVE_GLOBAL"] });
  });

  it("only accepts true or 1 as enabled", () => {
    for (const flag of ["yes", "on", "false", "0", ""]) {
      expect(readAiWorkerConfig({ AI_WORKER_ENABLED: flag }).enabled).toBe(false);
    }
    expect(readAiWorkerConfig({ AI_WORKER_ENABLED: "1" }).enabled).toBe(true);
  });

  it("clamps timings to their bounds and rejects malformed ones", () => {
    expect(readAiWorkerConfig({ AI_WORKER_LEASE_MS: "1000", AI_WORKER_POLL_INTERVAL_MS: "999999" })).toMatchObject({
      leaseMs: 15_000,
      pollIntervalMs: 60_000,
    });
    expect(() => readAiWorkerConfig({ AI_WORKER_LEASE_MS: "60s" })).toThrow(/Invalid AI worker setting/);
  });
});
