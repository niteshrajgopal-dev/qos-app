/**
 * Dedicated AI worker (ADR-AI-02 decision 14). Packaged as Dockerfile target
 * `ai-worker`. Connects with DATABASE_URL or DB_*, which must be a login
 * granted only qos_ai_worker. Refuses to start unless AI_WORKER_ENABLED and
 * every concurrency cap are set.
 */

import { hostname } from "node:os";

import { createDbClient } from "@/db/client";
import { createMenuManagerJobHandler } from "@/lib/agents/menu-manager/menu-manager-job";
import {
  claimNextAiJob,
  finishAiJobStep,
  heartbeatAiJob,
  markAiJobDispatched,
  type AiJobKind,
} from "@/lib/ai/jobs/ai-job-queue";
import { createAiWorker, type AiJobHandler } from "@/lib/ai/jobs/ai-worker";
import { aiWorkerReadiness, readAiWorkerConfig } from "@/lib/ai/jobs/ai-worker-config";
import { summarizeAiSpendUsage, usageSnapshotEvent } from "@/lib/ai/spend/spend-reconciliation";
import { createAiPhotoJobHandler } from "@/lib/media/ai-photos/ai-photo-job";
import { withTenantContext } from "@/lib/tenant/context";

function log(event: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

async function main() {
  const config = readAiWorkerConfig();
  const readiness = aiWorkerReadiness(config);
  if (!readiness.ready) {
    log({ event: "ai_worker.not_configured", missing: readiness.missing });
    process.exit(1);
  }

  const workerId = process.env.CONTAINER_APP_REPLICA_NAME?.trim() || `${hostname()}:${process.pid}`;
  const { db, sql } = createDbClient();

  const handlers = new Map<AiJobKind, AiJobHandler>();
  const menuManager = createMenuManagerJobHandler(db);
  handlers.set(menuManager.kind, menuManager);
  // Needs the AI photo provider settings and media storage settings of the web app.
  const aiPhotos = createAiPhotoJobHandler(db);
  handlers.set(aiPhotos.kind, aiPhotos);

  const worker = createAiWorker(
    {
      claim: () =>
        claimNextAiJob(db, {
          workerId,
          jobKinds: [...handlers.keys()],
          limits: {
            leaseMs: config.leaseMs,
            maxActiveGlobal: readiness.limits.maxActiveGlobal,
            maxActivePerTenant: readiness.limits.maxActivePerTenant,
            maxActivePerKind: readiness.limits.maxActivePerKind,
          },
        }),
      heartbeat: (job) => heartbeatAiJob(db, job, config.leaseMs),
      markDispatched: (job) => markAiJobDispatched(db, job),
      finish: (job, result) => finishAiJobStep(db, job, result),
      handlers,
      log,
      summarizeSpend: async (tenantId) =>
        withTenantContext(db, tenantId, async (tx) => {
          const summary = await summarizeAiSpendUsage(tx, { path: "ai_photo.async", tenantId });
          return usageSnapshotEvent(summary);
        }),
    },
    {
      workerId,
      concurrency: readiness.limits.concurrency,
      pollIntervalMs: config.pollIntervalMs,
      heartbeatIntervalMs: Math.floor(config.leaseMs / 3),
    },
  );

  let signalled = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (signalled) {
        log({ event: "ai_worker.forced_exit", workerId, signal });
        process.exit(1);
      }
      signalled = true;
      log({ event: "ai_worker.signal", workerId, signal });
      worker.stop();
    });
  }

  await worker.run();
  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  log({ event: "ai_worker.fatal", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
