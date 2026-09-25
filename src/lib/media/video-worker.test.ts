import { describe, expect, it } from "vitest";

import {
  decideVideoJobFailure,
  VideoJobError,
  type ClaimedVideoJob,
} from "@/lib/media/video-job-queue";
import { createVideoWorker, type VideoWorkerLogEvent } from "@/lib/media/video-worker";

function fakeJob(n: number): ClaimedVideoJob {
  return {
    jobId: `job-${n}`,
    tenantId: `ten-${n % 2}`,
    productId: `prd-${n}`,
    assetId: `ast-${n}`,
    correlationId: `vjob_${n}`,
    sourceStoragePath: `products/${n}/source.mp4`,
    retryCount: 0,
    workerId: "test-worker",
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("createVideoWorker", () => {
  it("never runs more than `concurrency` jobs at once and drains on stop", async () => {
    const queue = [1, 2, 3, 4, 5].map(fakeJob);
    const gates = new Map<string, ReturnType<typeof deferred>>();
    let running = 0;
    let peak = 0;
    const completed: string[] = [];

    const worker = createVideoWorker(
      {
        claim: async () => queue.shift() ?? null,
        process: async (job) => {
          running += 1;
          peak = Math.max(peak, running);
          const gate = deferred();
          gates.set(job.jobId, gate);
          await gate.promise;
          running -= 1;
          completed.push(job.jobId);
        },
        log: () => {},
      },
      { workerId: "w", concurrency: 2, pollIntervalMs: 1 },
    );

    const done = worker.run();
    await tick();
    expect(running).toBe(2);

    gates.get("job-1")!.resolve();
    await tick();
    expect(running).toBe(2);
    expect(gates.has("job-3")).toBe(true);

    worker.stop();
    for (const gate of gates.values()) {
      gate.resolve();
    }
    await done;

    expect(peak).toBe(2);
    // Stop means no new claims; only jobs already started are finished.
    expect(completed.sort()).toEqual(["job-1", "job-2", "job-3"]);
    expect(queue.map((j) => j.jobId)).toEqual(["job-4", "job-5"]);
  });

  it("keeps running after job failures and claim errors, logging each", async () => {
    const events: VideoWorkerLogEvent[] = [];
    let claims = 0;

    const worker = createVideoWorker(
      {
        claim: async () => {
          claims += 1;
          if (claims === 1) throw new Error("db unavailable");
          if (claims === 2) return fakeJob(1);
          if (claims === 3) return fakeJob(2);
          worker.stop();
          return null;
        },
        process: async (job) => {
          if (job.jobId === "job-1") {
            throw new VideoJobError("over-duration", false);
          }
        },
        log: (event) => events.push(event),
      },
      { workerId: "w", concurrency: 1, pollIntervalMs: 1 },
    );

    await worker.run();

    const names = events.map((e) => e.event);
    expect(names).toContain("video_worker.claim_failed");
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "video_worker.job_failed",
        jobId: "job-1",
        retryable: false,
        message: "over-duration",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: "video_worker.job_succeeded", jobId: "job-2" }),
    );
    expect(names.at(-1)).toBe("video_worker.stopped");
  });

  it("wakes from an idle poll immediately when stopped", async () => {
    const worker = createVideoWorker(
      { claim: async () => null, process: async () => {}, log: () => {} },
      { workerId: "w", concurrency: 1, pollIntervalMs: 60_000 },
    );

    const done = worker.run();
    await tick();
    const stoppedAt = Date.now();
    worker.stop();
    await done;

    expect(Date.now() - stoppedAt).toBeLessThan(1_000);
  });
});

describe("decideVideoJobFailure", () => {
  const config = { maxRetries: 3, retryBackoffMs: 30_000 };
  const now = new Date("2026-09-25T12:00:00Z");

  it("rejects non-retryable failures on the first attempt", () => {
    expect(decideVideoJobFailure(0, false, config, now)).toEqual({
      status: "rejected",
      retryCount: 1,
    });
  });

  it("backs off exponentially between retryable attempts", () => {
    const first = decideVideoJobFailure(0, true, config, now);
    const second = decideVideoJobFailure(1, true, config, now);

    expect(first).toEqual({
      status: "queued",
      retryCount: 1,
      nextAttemptAt: new Date(now.getTime() + 30_000),
    });
    expect(second).toEqual({
      status: "queued",
      retryCount: 2,
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });
  });

  it("quarantines once retries are exhausted", () => {
    expect(decideVideoJobFailure(2, true, config, now)).toEqual({
      status: "quarantined",
      retryCount: 3,
    });
  });
});
