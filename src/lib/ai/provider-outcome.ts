/**
 * What a failed provider operation proves about the remote side. Shared by
 * agent executors and model/image providers so retry and spend decisions never
 * depend on a vendor's error strings.
 *
 * - `not_dispatched`: proven the request never left QOS (validation, missing
 *   configuration, refused connection). Safe to try again.
 * - `rejected`: the provider confirmed it did not process the request (auth,
 *   documented rate limit, tool refusal before work started).
 * - `submission_unknown`: the request may have been accepted and may be billed,
 *   but there is no confirmed result or reference (timeout, reset after send,
 *   5xx, unreadable response to a submit).
 * - `failed_after_processing`: the provider confirmed failure, refusal or
 *   invalid output after doing work; usage may be billed.
 * - `read_failed`: a read or poll of a known reference failed. Reads are safe
 *   to repeat and never create provider work.
 *
 * Success-side states (a known accepted operation with a durable reference, or
 * a provider success whose local persistence failed) are run state, not errors.
 */
export type ProviderOutcome =
  | "not_dispatched"
  | "rejected"
  | "submission_unknown"
  | "failed_after_processing"
  | "read_failed";

export const PROVIDER_OUTCOMES = [
  "not_dispatched",
  "rejected",
  "submission_unknown",
  "failed_after_processing",
  "read_failed",
] as const satisfies readonly ProviderOutcome[];

export type ProviderFailureClassification = {
  outcome: ProviderOutcome;
  /** Whether the single retry owner may try again automatically. */
  retryable: boolean;
  /** Provider-advertised delay before a retry, when it sent one. */
  retryAfterMs: number | null;
};

/** Outcomes where the provider may already be doing, or have done, paid work. */
const POSSIBLY_PROCESSED: ReadonlySet<ProviderOutcome> = new Set([
  "submission_unknown",
  "failed_after_processing",
]);

/**
 * Builds a classification. A possibly processed outcome is never retryable,
 * whatever the caller asks for: a timeout or 5xx is not proof that
 * resubmission is safe.
 */
export function classifyProviderFailure(
  outcome: ProviderOutcome,
  options: { retryable?: boolean; retryAfterMs?: number | null } = {},
): ProviderFailureClassification {
  const retryable = POSSIBLY_PROCESSED.has(outcome) ? false : (options.retryable ?? false);
  return { outcome, retryable, retryAfterMs: options.retryAfterMs ?? null };
}

/** True only when resubmitting the same logical request cannot duplicate provider work. */
export function permitsAutomaticResubmission(classification: ProviderFailureClassification) {
  return (
    classification.retryable &&
    (classification.outcome === "not_dispatched" || classification.outcome === "rejected")
  );
}

/** True when usage must be treated as possibly billed for spend accounting. */
export function mayHaveBilledUsage(outcome: ProviderOutcome) {
  return POSSIBLY_PROCESSED.has(outcome);
}

/**
 * Parses `retry-after-ms` or `Retry-After` (seconds or HTTP date). Returns null
 * when absent or unparseable; never negative.
 */
export function parseRetryAfterMs(headers: Pick<Headers, "get">, now: Date = new Date()) {
  const milliseconds = headers.get("retry-after-ms");
  if (milliseconds !== null && /^\d+(\.\d+)?$/.test(milliseconds.trim())) {
    return Math.round(Number(milliseconds));
  }
  const value = headers.get("retry-after")?.trim();
  if (!value) {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.round(Number(value) * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
}
