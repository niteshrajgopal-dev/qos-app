import { classifyProviderFailure } from "@/lib/ai/provider-outcome";
import { MenuExtractionVisionError } from "@/lib/catalogue/menu-extraction/menu-extraction-vision-errors";

function readOpenAiErrorBody(error: {
  error?: unknown;
  code?: string | null;
  param?: string | null;
  type?: string;
  message?: string;
}) {
  const nested =
    error.error && typeof error.error === "object"
      ? (error.error as { code?: unknown; type?: unknown; param?: unknown; message?: unknown })
      : {};
  const providerCode =
    typeof nested.code === "string"
      ? nested.code
      : typeof error.code === "string"
        ? error.code
        : null;
  const providerType =
    typeof nested.type === "string" ? nested.type : typeof error.type === "string" ? error.type : null;
  const providerParam =
    typeof nested.param === "string"
      ? nested.param
      : typeof error.param === "string"
        ? error.param
        : null;
  const providerMessage =
    typeof nested.message === "string" ? nested.message : typeof error.message === "string" ? error.message : "";
  return { providerCode, providerType, providerParam, providerMessage };
}

export function classifyMenuExtractionVisionError(error: unknown): MenuExtractionVisionError {
  if (error instanceof MenuExtractionVisionError) {
    return error;
  }

  const OpenAI = loadOpenAiErrorTypes();
  if (OpenAI?.APIConnectionTimeoutError && error instanceof OpenAI.APIConnectionTimeoutError) {
    return new MenuExtractionVisionError(
      "provider_timeout",
      "The vision service took too long to respond.",
      {},
      classifyProviderFailure("submission_unknown"),
    );
  }
  if (OpenAI?.APIConnectionError && error instanceof OpenAI.APIConnectionError) {
    return new MenuExtractionVisionError(
      "provider_unavailable",
      "The vision service could not be reached.",
      {},
      classifyProviderFailure("not_dispatched", { retryable: true }),
    );
  }
  if (OpenAI?.APIUserAbortError && error instanceof OpenAI.APIUserAbortError) {
    return new MenuExtractionVisionError(
      "provider_timeout",
      "The vision service request was aborted.",
      {},
      classifyProviderFailure("submission_unknown"),
    );
  }

  if (OpenAI?.APIError && error instanceof OpenAI.APIError) {
    const apiError = error as {
      status?: number;
      message: string;
      error?: unknown;
      code?: string | null;
      param?: string | null;
      type?: string;
    };
    const status = apiError.status ?? undefined;
    const { providerCode, providerType, providerParam, providerMessage } =
      readOpenAiErrorBody(apiError);
    const haystack = `${providerCode ?? ""} ${providerType ?? ""} ${providerMessage} ${apiError.message}`.toLowerCase();
    const diagnostics = {
      httpStatus: status,
      providerCode,
      providerType,
      providerParam,
    };
    if (
      status === 400 &&
      (haystack.includes("json_schema") ||
        haystack.includes("response_format") ||
        haystack.includes("invalid schema") ||
        providerParam?.includes("response_format"))
    ) {
      return new MenuExtractionVisionError(
        "schema_rejected",
        "The menu extraction response schema was rejected by the vision service.",
        diagnostics,
      );
    }
    if (
      status === 404 ||
      providerCode === "model_not_found" ||
      haystack.includes("does not exist") ||
      haystack.includes("not a chat model") ||
      haystack.includes("not supported")
    ) {
      return new MenuExtractionVisionError(
        "model_not_supported",
        "The configured vision model does not support menu extraction.",
        diagnostics,
      );
    }
    if (status === 401 || status === 403) {
      return new MenuExtractionVisionError(
        "provider_rejected_request",
        "The vision service rejected QOS credentials.",
        diagnostics,
      );
    }
    if (status === 429) {
      return new MenuExtractionVisionError(
        "provider_rejected_request",
        "The vision service is rate limited.",
        diagnostics,
        classifyProviderFailure("rejected", { retryable: true }),
      );
    }
    if (status && status >= 500) {
      return new MenuExtractionVisionError(
        "model_submission_unknown",
        "The vision service returned an error and the outcome is uncertain.",
        diagnostics,
        classifyProviderFailure("submission_unknown"),
      );
    }
    if (status === 400) {
      return new MenuExtractionVisionError(
        "provider_rejected_request",
        "The vision service rejected the menu extraction request.",
        diagnostics,
      );
    }
  }

  return new MenuExtractionVisionError(
    "model_submission_unknown",
    "QOS could not confirm whether the model accepted this menu extraction.",
    {},
    classifyProviderFailure("submission_unknown"),
  );
}

function loadOpenAiErrorTypes(): {
  APIError?: new (...args: never[]) => unknown;
  APIConnectionError?: new (...args: never[]) => unknown;
  APIConnectionTimeoutError?: new (...args: never[]) => unknown;
  APIUserAbortError?: new (...args: never[]) => unknown;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require("openai") as {
      APIError: new (...args: never[]) => unknown;
      APIConnectionError: new (...args: never[]) => unknown;
      APIConnectionTimeoutError: new (...args: never[]) => unknown;
      APIUserAbortError: new (...args: never[]) => unknown;
    };
    return OpenAI;
  } catch {
    return null;
  }
}
