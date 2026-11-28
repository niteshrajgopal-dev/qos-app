/* Public surface of the workbook apply engine (QOS-217), used by the routes
   and the evidence tooling. Later QOS-200 handlers plug in through
   `registerFieldExtension` and `handlers/index.ts`. */

export { FIELD_CAPABILITIES, registerFieldExtension, type FieldExtension } from "@/lib/workbook/apply/capability";
export { describeApplyFailure, WorkbookApplyError, type WorkbookApplyErrorCode } from "@/lib/workbook/apply/errors";
export type { ApplyHooks, ImageIngester } from "@/lib/workbook/apply/handlers/types";
export type * from "@/lib/workbook/apply/model";
export { APPLY_LOCK_TIMEOUT_MS } from "@/lib/workbook/apply/repository";
export { applyWorkbookPlan, parseApplyBody, repairPlanIfInterrupted, withApplyView } from "@/lib/workbook/apply/service";
export { APPLY_HISTORY_DEFAULT_LIMIT, APPLY_HISTORY_MAX_LIMIT, listRecentApplies, parseHistoryLimit } from "@/lib/workbook/apply/history";
