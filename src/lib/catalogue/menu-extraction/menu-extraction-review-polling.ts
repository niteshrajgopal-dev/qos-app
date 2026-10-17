export type MenuExtractionRunStatus = "queued" | "running" | "completed" | "failed" | string;

export function shouldPollMenuExtractionReview(status: MenuExtractionRunStatus | null | undefined) {
  return status === "queued" || status === "running";
}

export function isTerminalMenuExtractionRun(status: MenuExtractionRunStatus | null | undefined) {
  return status === "completed" || status === "failed" || status === "cancelled";
}
