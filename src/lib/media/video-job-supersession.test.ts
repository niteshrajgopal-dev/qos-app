import { describe, expect, test } from "vitest";

import { decideVideoJobFailure } from "@/lib/media/video-job-queue";

describe("Video job supersession", () => {
  test("queued job supersession logic marks jobs as rejected", () => {
    const decision = decideVideoJobFailure(0, false, {
      maxRetries: 3,
      retryBackoffMs: 30_000,
    });

    expect(decision.status).toBe("rejected");
    expect(decision.retryCount).toBe(1);
  });

  test("retryable errors are re-queued with backoff", () => {
    const decision = decideVideoJobFailure(
      0,
      true,
      {
        maxRetries: 3,
        retryBackoffMs: 30_000,
      },
      new Date("2025-01-01T00:00:00Z"),
    );

    expect(decision.status).toBe("queued");
    expect(decision.retryCount).toBe(1);
    if (decision.status === "queued") {
      expect(decision.nextAttemptAt).toEqual(new Date("2025-01-01T00:00:30Z"));
    }
  });

  test("retryable errors are quarantined after max retries", () => {
    const decision = decideVideoJobFailure(3, true, {
      maxRetries: 3,
      retryBackoffMs: 30_000,
    });

    expect(decision.status).toBe("quarantined");
    expect(decision.retryCount).toBe(4);
  });
});
