import { classifyProviderFailure, type ProviderFailureClassification } from "@/lib/ai/provider-outcome";

export const MENU_EXTRACTION_VISION_FAILURE_CODES = [
  "provider_rejected_request",
  "model_not_supported",
  "schema_rejected",
  "provider_timeout",
  "provider_unavailable",
  "model_submission_unknown",
] as const;

export type MenuExtractionVisionFailureCode =
  (typeof MENU_EXTRACTION_VISION_FAILURE_CODES)[number];

export type MenuExtractionVisionFailureDiagnostics = {
  httpStatus?: number;
  providerType?: string | null;
  providerCode?: string | null;
  providerParam?: string | null;
  message: string;
};

export class MenuExtractionVisionError extends Error {
  readonly code: MenuExtractionVisionFailureCode;
  readonly diagnostics: MenuExtractionVisionFailureDiagnostics;
  readonly classification: ProviderFailureClassification;

  constructor(
    code: MenuExtractionVisionFailureCode,
    message: string,
    diagnostics: Omit<MenuExtractionVisionFailureDiagnostics, "message"> = {},
    classification?: ProviderFailureClassification,
  ) {
    super(message);
    this.name = "MenuExtractionVisionError";
    this.code = code;
    this.diagnostics = { ...diagnostics, message };
    this.classification =
      classification ?? defaultClassificationForCode(code, diagnostics.httpStatus);
  }
}

function defaultClassificationForCode(
  code: MenuExtractionVisionFailureCode,
  httpStatus?: number,
): ProviderFailureClassification {
  switch (code) {
    case "provider_unavailable":
      return classifyProviderFailure("not_dispatched", { retryable: true });
    case "provider_rejected_request":
    case "model_not_supported":
    case "schema_rejected":
      return classifyProviderFailure("rejected");
    case "provider_timeout":
      return classifyProviderFailure("submission_unknown");
    case "model_submission_unknown":
      return classifyProviderFailure(
        httpStatus && httpStatus >= 500 ? "submission_unknown" : "submission_unknown",
      );
    default:
      return classifyProviderFailure("submission_unknown");
  }
}

export function logMenuExtractionVisionFailure(
  correlationId: string,
  error: MenuExtractionVisionError,
) {
  console.warn(
    JSON.stringify({
      event: "catalogue.menu_extraction.vision_failed",
      correlationId,
      code: error.code,
      httpStatus: error.diagnostics.httpStatus ?? null,
      providerType: error.diagnostics.providerType ?? null,
      providerCode: error.diagnostics.providerCode ?? null,
      providerParam: error.diagnostics.providerParam ?? null,
      message: error.diagnostics.message,
    }),
  );
}

export function spendOutcomeForMenuExtractionVisionFailure(
  error: MenuExtractionVisionError,
): "completed" | "rejected" | "submission_unknown" | "not_dispatched" | "failed_after_processing" {
  const outcome = error.classification.outcome;
  if (outcome === "read_failed") {
    return "submission_unknown";
  }
  return outcome;
}
