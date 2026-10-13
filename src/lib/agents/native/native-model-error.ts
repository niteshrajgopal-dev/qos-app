/** Safe fields from a failed model call for logs and run diagnostics (never secrets or prompts). */
export type NativeModelErrorDiagnostics = {
  modelId: string;
  httpStatus?: number;
  errorType?: string;
  errorCode?: string;
  errorName?: string;
};

export function nativeModelErrorDiagnostics(
  error: unknown,
  modelId: string,
): NativeModelErrorDiagnostics {
  const diagnostics: NativeModelErrorDiagnostics = { modelId };
  if (!error || typeof error !== "object") {
    if (typeof error === "string" && error.length > 0) {
      diagnostics.errorName = error.slice(0, 200);
    }
    return diagnostics;
  }
  const record = error as Record<string, unknown>;
  if (typeof record.name === "string") {
    diagnostics.errorName = record.name;
  }
  if (typeof record.status === "number" && Number.isInteger(record.status)) {
    diagnostics.httpStatus = record.status;
  }
  if (typeof record.type === "string") {
    diagnostics.errorType = record.type;
  }
  if (typeof record.code === "string") {
    diagnostics.errorCode = record.code;
  }
  return diagnostics;
}
