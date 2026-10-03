import { afterEach, describe, expect, it, vi } from "vitest";

import { AiJobLeaseLostError, type AiJobStepResult, type ClaimedAiJob } from "@/lib/ai/jobs/ai-job-queue";
import {
  createAiWorker,
  type AiJobHandler,
  type AiJobStepContext,
  type AiWorkerDeps,
  type AiWorkerLogEvent,
} from "@/lib/ai/jobs/ai-worker";

let seq = 0;
function job(overrides: Partial<ClaimedAiJob> = {}): ClaimedAiJob {
  seq += 1;
  return {
    jobId: `id-${seq}`,
    tenantId: "tenant-1",
    jobPublicId: `job_${seq}`,
    jobKind: "menu_manager.run",
    agentRunId: `run-${seq}`,
    leaseToken: `token-${seq}`,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    attemptNumber: 1,
    uncertainPriorDispatch: false,
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(options: {
  claims: (ClaimedAiJob | null | Error)[];
  step?: AiJobHandler["step"];
  finish?: AiWorkerDeps["finish"];
  heartbeat?: AiWorkerDeps["heartbeat"];
  concurrency?: number;
}) {
  const logs: AiWorkerLogEvent[] = [];
  const queue = [...options.claims];
  const deps: AiWorkerDeps = {
    claim: vi.fn(async () => {
      const next = queue.length > 0 ? queue.shift()! : null;
      if (next instanceof Error) throw next;
      return next;
    }),
    heartbeat: vi.fn(options.heartbeat ?? (async () => new Date(Date.now() + 60_000))),
    markDispatched: vi.fn(async () => undefined),
    finish: vi.fn(options.finish ?? (async () => undefined)),
    handlers: new Map([
      [
        "menu_manager.run",
        { kind: "menu_manager.run", step: vi.fn(options.step ?? (async (): Promise<AiJobStepResult> => ({ type: "completed" }))) },
      ],
    ]),
    log: (event) => logs.push(event),
  };
  const worker = createAiWorker(deps, {
    workerId: "w-1",
    concurrency: options.concurrency ?? 1,
    pollIntervalMs: 5,
    heartbeatIntervalMs: 1_000,
  });
  return { deps, worker, logs, events: () => logs.map((l) => l.event) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AI worker loop", () => {
  it("steps each claimed job through its handler, finishes it, and stops gracefully", async () => {
    const claimed = job();
    const { deps, worker, logs } = setup({ claims: [claimed] });
    const running = worker.run();

    await vi.waitFor(() => expect(deps.finish).toHaveBeenCalledWith(claimed, { type: "completed" }));
    worker.stop();
    await running;

    expect(logs).toContainEqual(
      expect.objectContaining({ event: "ai_worker.job_stepped", jobPublicId: claimed.jobPublicId, result: "completed" }),
    );
    expect(logs.at(-1)).toEqual({ event: "ai_worker.stopped", workerId: "w-1" });
  });

  it("never runs more steps at once than its concurrency, and drains in-flight steps on stop", async () => {
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const { deps, worker } = setup({
      claims: [job(), job(), job(), job()],
      concurrency: 2,
      step: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        return { type: "completed" };
      },
    });
    const running = worker.run();

    await vi.waitFor(() => expect(active).toBe(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(deps.claim).toHaveBeenCalledTimes(2);

    worker.stop();
    gate.resolve();
    await running;
    expect(peak).toBe(2);
    expect(deps.finish).toHaveBeenCalledTimes(2);
  });

  it("does not finish a step that crashed, so its lease expires instead", async () => {
    const { deps, worker, logs } = setup({
      claims: [job()],
      step: async () => {
        throw new Error("boom");
      },
    });
    const running = worker.run();
    await vi.waitFor(() => expect(logs.map((l) => l.event)).toContain("ai_worker.step_crashed"));
    worker.stop();
    await running;

    expect(deps.finish).not.toHaveBeenCalled();
    expect(logs).toContainEqual(expect.objectContaining({ event: "ai_worker.step_crashed", message: "boom" }));
  });

  it("logs a lost lease separately from a crash", async () => {
    const claimed = job();
    const { worker, events } = setup({
      claims: [claimed],
      finish: async () => {
        throw new AiJobLeaseLostError(claimed.jobPublicId);
      },
    });
    const running = worker.run();
    await vi.waitFor(() => expect(events()).toContain("ai_worker.lease_lost"));
    worker.stop();
    await running;
    expect(events()).not.toContain("ai_worker.step_crashed");
  });

  it("fails a job whose kind has no handler", async () => {
    const claimed = job({ jobKind: "other.kind" as ClaimedAiJob["jobKind"] });
    const { deps, worker } = setup({ claims: [claimed] });
    const running = worker.run();
    await vi.waitFor(() =>
      expect(deps.finish).toHaveBeenCalledWith(claimed, expect.objectContaining({ type: "failed", code: "unknown_job_kind" })),
    );
    worker.stop();
    await running;
  });

  it("keeps polling after a claim error", async () => {
    const claimed = job();
    const { deps, worker, events } = setup({ claims: [new Error("db down"), claimed] });
    const running = worker.run();
    await vi.waitFor(() => expect(deps.finish).toHaveBeenCalledWith(claimed, { type: "completed" }));
    worker.stop();
    await running;
    expect(events()).toContain("ai_worker.claim_failed");
  });

  it("tells the step once a heartbeat finds the lease gone, and passes dispatch through", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    let context: AiJobStepContext | null = null;
    const claimed = job();
    const { deps, worker } = setup({
      claims: [claimed],
      heartbeat: async () => null,
      step: async (_job, ctx) => {
        context = ctx;
        await ctx.markDispatched();
        await gate.promise;
        return { type: "completed" };
      },
    });
    const running = worker.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(context!.leaseLost()).toBe(false);
    expect(deps.markDispatched).toHaveBeenCalledWith(claimed);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.heartbeat).toHaveBeenCalledWith(claimed);
    expect(context!.leaseLost()).toBe(true);

    worker.stop();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(10);
    await running;
  });
});
