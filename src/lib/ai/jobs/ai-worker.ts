import {
  AiJobLeaseLostError,
  type AiJobKind,
  type AiJobStepResult,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";

/**
 * One step of a job (ADR-AI-02 decision 13): a bounded unit of work between
 * durable checkpoints, not a checkpointed agent loop. A step calls
 * `markDispatched` and lets it commit before contacting a provider.
 */
export type AiJobHandler = {
  kind: AiJobKind;
  step(job: ClaimedAiJob, context: AiJobStepContext): Promise<AiJobStepResult>;
};

export type AiJobStepContext = {
  markDispatched(): Promise<void>;
  /** True once a heartbeat found the lease gone; the step should stop early. */
  leaseLost(): boolean;
};

export type AiWorkerLogEvent =
  | { event: "ai_worker.started"; workerId: string; concurrency: number; pollIntervalMs: number }
  | { event: "ai_worker.claim_failed"; workerId: string; message: string }
  | { event: "ai_worker.job_started"; workerId: string; jobPublicId: string; tenantId: string; jobKind: string; attempt: number }
  | { event: "ai_worker.job_stepped"; workerId: string; jobPublicId: string; tenantId: string; result: AiJobStepResult["type"]; durationMs: number }
  | { event: "ai_worker.lease_lost"; workerId: string; jobPublicId: string; tenantId: string }
  | { event: "ai_worker.step_crashed"; workerId: string; jobPublicId: string; tenantId: string; message: string }
  | { event: "ai_worker.stopping"; workerId: string; inFlight: number }
  | { event: "ai_worker.stopped"; workerId: string };

export type AiWorkerDeps = {
  claim: () => Promise<ClaimedAiJob | null>;
  heartbeat: (job: ClaimedAiJob) => Promise<Date | null>;
  markDispatched: (job: ClaimedAiJob) => Promise<void>;
  finish: (job: ClaimedAiJob, result: AiJobStepResult) => Promise<unknown>;
  handlers: ReadonlyMap<AiJobKind, AiJobHandler>;
  log: (event: AiWorkerLogEvent) => void;
};

export type AiWorkerOptions = {
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
};

export type AiWorker = {
  /** Resolves once stopped and every in-flight step has settled. */
  run(): Promise<void>;
  /** Stop claiming; in-flight steps finish (graceful shutdown). */
  stop(): void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Poll-claim-step loop with bounded concurrency. Caps and fairness live in the
 * claim. A step that throws unexpectedly is not finished: its lease expires,
 * and the next claim reports whether it had begun dispatch so the handler can
 * route it to operator review instead of resubmitting.
 */
export function createAiWorker(deps: AiWorkerDeps, options: AiWorkerOptions): AiWorker {
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

  async function runJob(job: ClaimedAiJob) {
    const base = { workerId, jobPublicId: job.jobPublicId, tenantId: job.tenantId };
    const startedAt = Date.now();
    deps.log({ event: "ai_worker.job_started", ...base, jobKind: job.jobKind, attempt: job.attemptNumber });

    let lost = false;
    const beat = setInterval(() => {
      deps
        .heartbeat(job)
        .then((expires) => {
          if (!expires) {
            lost = true;
          }
        })
        .catch(() => undefined);
    }, Math.max(1_000, options.heartbeatIntervalMs));

    try {
      const handler = deps.handlers.get(job.jobKind);
      const result: AiJobStepResult = handler
        ? await handler.step(job, {
            markDispatched: () => deps.markDispatched(job),
            leaseLost: () => lost,
          })
        : { type: "failed", code: "unknown_job_kind", message: `No handler for ${job.jobKind}.` };
      await deps.finish(job, result);
      deps.log({ event: "ai_worker.job_stepped", ...base, result: result.type, durationMs: Date.now() - startedAt });
    } catch (error) {
      if (error instanceof AiJobLeaseLostError) {
        deps.log({ event: "ai_worker.lease_lost", ...base });
      } else {
        deps.log({ event: "ai_worker.step_crashed", ...base, message: errorMessage(error) });
      }
    } finally {
      clearInterval(beat);
    }
  }

  async function run() {
    deps.log({ event: "ai_worker.started", workerId, concurrency, pollIntervalMs: options.pollIntervalMs });

    while (!stopping) {
      if (inFlight.size >= concurrency) {
        await Promise.race(inFlight);
        continue;
      }

      let job: ClaimedAiJob | null;
      try {
        job = await deps.claim();
      } catch (error) {
        deps.log({ event: "ai_worker.claim_failed", workerId, message: errorMessage(error) });
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

    deps.log({ event: "ai_worker.stopping", workerId, inFlight: inFlight.size });
    await Promise.allSettled([...inFlight]);
    deps.log({ event: "ai_worker.stopped", workerId });
  }

  function stop() {
    stopping = true;
    wake?.();
  }

  return { run, stop };
}
