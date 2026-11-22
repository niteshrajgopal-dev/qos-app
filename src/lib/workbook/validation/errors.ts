/* Recoverable review errors (QOS-194). `code` is stable and is what the staff
   UI translates; `message` is English for logs and API clients. Kept apart
   from WorkbookParseError so parse codes and review codes never mix. */

export type WorkbookReviewErrorCode =
  | "review_unsupported_profile"
  | "review_context_rejected"
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "plan_not_found"
  | "plan_not_yours"
  | "plan_hash_mismatch"
  | "decisions_invalid"
  | "apply_in_progress"
  | "plan_applied";

export class WorkbookReviewError extends Error {
  readonly code: WorkbookReviewErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;

  constructor(code: WorkbookReviewErrorCode, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkbookReviewError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
