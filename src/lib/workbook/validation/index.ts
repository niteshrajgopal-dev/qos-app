/* Public surface of the workbook review engine (QOS-194), used by the
   routes, the evidence tooling and QOS-217 later. */

export { buildCorrectionReport, correctionReportFileName } from "@/lib/workbook/validation/correction-report";
export { WorkbookReviewError, type WorkbookReviewErrorCode } from "@/lib/workbook/validation/errors";
export { toReviewInput } from "@/lib/workbook/validation/input";
export type * from "@/lib/workbook/validation/model";
export { planHash, rowsDigest } from "@/lib/workbook/validation/plan-hash";
export { hashReview, inputFromPlan, isPlanPublicId, storedDecisions } from "@/lib/workbook/validation/plan-repository";
export { REVIEW_ENGINE_VERSION, reviewWorkbook } from "@/lib/workbook/validation/review";
export {
  getWorkbookPlan,
  loadWorkbookPlanForReport,
  parseDecisionsField,
  parseReReviewBody,
  previewWorkbook,
  reReviewWorkbookPlan,
} from "@/lib/workbook/validation/service";
export { buildReviewSnapshot, loadReviewSnapshot, loadSnapshotSource, restrictSourceToScope } from "@/lib/workbook/validation/snapshot";
