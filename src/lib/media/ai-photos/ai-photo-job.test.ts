import { describe, expect, it } from "vitest";

import { aiPhotoRetryDelayMs, DEFAULT_AI_PHOTO_RETRY_POLICY } from "@/lib/media/ai-photos/ai-photo-job";

describe("aiPhotoRetryDelayMs", () => {
  const middle = () => 0.5;

  it("backs off exponentially within the cap and stops after the last attempt", () => {
    expect(aiPhotoRetryDelayMs(1, null, DEFAULT_AI_PHOTO_RETRY_POLICY, middle)).toBe(30_000);
    expect(aiPhotoRetryDelayMs(2, null, DEFAULT_AI_PHOTO_RETRY_POLICY, middle)).toBe(60_000);
    expect(aiPhotoRetryDelayMs(3, null, DEFAULT_AI_PHOTO_RETRY_POLICY, middle)).toBeNull();
    const capped = { ...DEFAULT_AI_PHOTO_RETRY_POLICY, maxAttempts: 10 };
    expect(aiPhotoRetryDelayMs(9, null, capped, middle)).toBe(capped.maxDelayMs);
  });

  it("jitters within 20% either way", () => {
    expect(aiPhotoRetryDelayMs(1, null, DEFAULT_AI_PHOTO_RETRY_POLICY, () => 0)).toBe(24_000);
    expect(aiPhotoRetryDelayMs(1, null, DEFAULT_AI_PHOTO_RETRY_POLICY, () => 1)).toBe(36_000);
  });

  it("never retries sooner than the provider asked, and gives up when it asks for too long", () => {
    expect(aiPhotoRetryDelayMs(1, 90_000, DEFAULT_AI_PHOTO_RETRY_POLICY, middle)).toBe(90_000);
    expect(aiPhotoRetryDelayMs(1, 16 * 60_000, DEFAULT_AI_PHOTO_RETRY_POLICY, middle)).toBeNull();
  });
});
