import type { ClaimedVideoJob } from "@/lib/media/video-job-queue";
import { VideoJobError } from "@/lib/media/video-job-queue";

export type VideoWorkerLogEvent =
  | { event: "video_worker.started"; workerId: string; concurrency: number; pollIntervalMs: number }
  | { event: "video_worker.claim_failed"; workerId: string; message: string }
  | { event: "video_worker.job_started"; workerId: string; jobId: string; tenantId: string; correlationId: string; attempt: number }
  | { event: "video_worker.job_succeeded"; workerId: string; jobId: string; tenantId: string; correlationId: string; durationMs: number }
  | { event: "video_worker.job_failed"; workerId: string; jobId: string; tenantId: string; correlationId: string; durationMs: number; retryable: boolean; message: string }
  | { event: "video_worker.stopping"; workerId: string; inFlight: number }
  | { event: "video_worker.stopped"; workerId: string };

export type VideoWorkerDeps = {
  claim: () => Promise<ClaimedVideoJob | null>;
  process: (job: ClaimedVideoJob) => Promise<void>;
  log: (event: VideoWorkerLogEvent) => void;
};

export type VideoWorkerOptions = {
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
};

export type VideoWorker = {
  /** Resolves once stopped and all in-flight jobs have settled. */
  run(): Promise<void>;
  /** Stop claiming new jobs; in-flight jobs are allowed to finish. */
  stop(): void;
};

/**
 * Poll-claim-process loop with bounded concurrency.
 *
 * Fairness and per-tenant caps are enforced by the claim itself; this loop
 * only bounds how many jobs this process runs at once. A crash or forced kill
 * mid-job is recovered by lease expiry on the next claim.
 */
export function createVideoWorker(
  deps: VideoWorkerDeps,
  options: VideoWorkerOptions,
): VideoWorker {
  const { workerId } = options;
  const concurrency = Math.max(1, options.concurrency);
  const inFlight = new Set<Promise<void>>();
  let stopping = false;
  let wake: (() => void) | null = null;

  function idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = done;
    });
  }

  async function runJob(job: ClaimedVideoJob) {
    const startedAt = Date.now();
    const base = {
      workerId,
      jobId: job.jobId,
      tenantId: job.tenantId,
      correlationId: job.correlationId,
    };

    deps.log({ event: "video_worker.job_started", ...base, attempt: job.retryCount + 1 });

    try {
      await deps.process(job);
      deps.log({
        event: "video_worker.job_succeeded",
        ...base,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      deps.log({
        event: "video_worker.job_failed",
        ...base,
        durationMs: Date.now() - startedAt,
        retryable: error instanceof VideoJobError ? error.retryable : true,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function run() {
    deps.log({
      event: "video_worker.started",
      workerId,
      concurrency,
      pollIntervalMs: options.pollIntervalMs,
    });

    while (!stopping) {
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight);
        continue;
      }

      let job: ClaimedVideoJob | null;
      try {
        job = await deps.claim();
      } catch (error) {
        deps.log({
          event: "video_worker.claim_failed",
          workerId,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        await idle(options.pollIntervalMs);
        continue;
      }

      if (!job) {
        await idle(options.pollIntervalMs);
        continue;
      }

      const task: Promise<void> = runJob(job).finally(() => {
        inFlight.delete(task);
      });
      inFlight.add(task);
    }

    deps.log({ event: "video_worker.stopping", workerId, inFlight: inFlight.size });
    await Promise.allSettled([...inFlight]);
    deps.log({ event: "video_worker.stopped", workerId });
  }

  function stop() {
    stopping = true;
    wake?.();
  }

  return { run, stop };
}
