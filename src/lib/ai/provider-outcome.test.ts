import { describe, expect, it } from "vitest";

import {
  PROVIDER_OUTCOMES,
  classifyProviderFailure,
  mayHaveBilledUsage,
  parseRetryAfterMs,
  permitsAutomaticResubmission,
} from "@/lib/ai/provider-outcome";

describe("classifyProviderFailure", () => {
  it("never marks a possibly processed outcome as retryable", () => {
    for (const outcome of ["submission_unknown", "failed_after_processing"] as const) {
      const classification = classifyProviderFailure(outcome, { retryable: true });
      expect(classification.retryable).toBe(false);
      expect(permitsAutomaticResubmission(classification)).toBe(false);
      expect(mayHaveBilledUsage(outcome)).toBe(true);
    }
  });

  it("defaults to not retryable", () => {
    for (const outcome of PROVIDER_OUTCOMES) {
      expect(classifyProviderFailure(outcome).retryable).toBe(false);
    }
  });

  it("permits automatic resubmission only for proven non-processing", () => {
    expect(permitsAutomaticResubmission(classifyProviderFailure("not_dispatched", { retryable: true }))).toBe(true);
    expect(permitsAutomaticResubmission(classifyProviderFailure("rejected", { retryable: true }))).toBe(true);
    expect(permitsAutomaticResubmission(classifyProviderFailure("rejected"))).toBe(false);
    // A read retry polls a known reference; it is never a resubmission.
    expect(permitsAutomaticResubmission(classifyProviderFailure("read_failed", { retryable: true }))).toBe(false);
    expect(mayHaveBilledUsage("read_failed")).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);
  const now = new Date("2026-10-02T12:00:00Z");

  it("prefers retry-after-ms, then seconds, then an HTTP date", () => {
    expect(parseRetryAfterMs(headers({ "retry-after-ms": "1500", "retry-after": "9" }), now)).toBe(1500);
    expect(parseRetryAfterMs(headers({ "retry-after": "2" }), now)).toBe(2000);
    expect(parseRetryAfterMs(headers({ "retry-after": "Fri, 02 Oct 2026 12:00:30 GMT" }), now)).toBe(30_000);
  });

  it("returns null for missing or malformed values and never goes negative", () => {
    expect(parseRetryAfterMs(headers({}), now)).toBeNull();
    expect(parseRetryAfterMs(headers({ "retry-after": "soon" }), now)).toBeNull();
    expect(parseRetryAfterMs(headers({ "retry-after": "Fri, 02 Oct 2026 11:00:00 GMT" }), now)).toBe(0);
  });
});
