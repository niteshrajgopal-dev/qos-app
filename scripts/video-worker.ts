import { hostname } from "node:os";

import { createDbClient } from "@/db/client";
import { readMediaConfig } from "@/lib/media/config";
import { getMediaStorage } from "@/lib/media/storage";
import { readVideoProcessingConfig } from "@/lib/media/video-config";
import { claimNextQueuedJob, processVideoJob } from "@/lib/media/video-job-queue";
import { assertVideoToolchainAvailable } from "@/lib/media/video-validation";
import { createVideoWorker } from "@/lib/media/video-worker";

function log(event: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

async function main() {
  const config = readVideoProcessingConfig();
  const media = readMediaConfig();
  getMediaStorage();
  const toolchain = await assertVideoToolchainAvailable();

  const workerId =
    process.env.CONTAINER_APP_REPLICA_NAME?.trim() || `${hostname()}:${process.pid}`;

  log({
    event: "video_worker.boot",
    workerId,
    mediaStorage: media.storageBackend,
    ffmpeg: toolchain.ffmpeg,
    ffprobe: toolchain.ffprobe,
    maxConcurrentJobs: config.maxConcurrentJobs,
    maxActiveJobsPerTenant: config.maxActiveJobsPerTenant,
    maxRetries: config.maxRetries,
    jobTimeoutMs: config.jobTimeoutMs,
    jobLeaseMs: config.jobLeaseMs,
  });

  const { db, sql } = createDbClient();

  const worker = createVideoWorker(
    {
      claim: () => claimNextQueuedJob(db, { workerId, config }),
      process: (job) => processVideoJob(db, job, { config }),
      log,
    },
    {
      workerId,
      concurrency: config.maxConcurrentJobs,
      pollIntervalMs: config.workerPollIntervalMs,
    },
  );

  let signalled = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (signalled) {
        log({ event: "video_worker.forced_exit", workerId, signal });
        process.exit(1);
      }
      signalled = true;
      log({ event: "video_worker.signal", workerId, signal });
      worker.stop();
    });
  }

  await worker.run();
  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  log({
    event: "video_worker.fatal",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
