import { classifyProviderFailure, parseRetryAfterMs } from "@/lib/ai/provider-outcome";
import type { AiPhotoQuality } from "@/lib/media/ai-photos/config";
import {
  AiPhotoProviderError,
  type AiPhotoProvider,
  type AiPhotoUsage,
} from "@/lib/media/ai-photos/provider-contract";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
/** Upper bound on the base64 body we will buffer (a 1024px JPEG is far smaller). */
const MAX_RESPONSE_CHARS = 20_000_000;

/** Socket errors that prove the request never reached the provider. */
const CONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function readUsage(value: unknown): AiPhotoUsage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const usage = value as Record<string, unknown>;
  const num = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : null);
  return {
    inputTokens: num("input_tokens"),
    outputTokens: num("output_tokens"),
    totalTokens: num("total_tokens"),
  };
}

function connectFailureCode(error: unknown) {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const code =
    cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" && CONNECT_FAILURE_CODES.has(code) ? code : null;
}

/**
 * Maps a provider error body to a stable code. Provider messages are not
 * passed through: they can echo prompt text and are not staff-facing copy.
 */
function errorFromResponse(status: number, body: unknown, headers: Headers): AiPhotoProviderError {
  const error =
    body && typeof body === "object" && "error" in body
      ? ((body as { error?: { code?: unknown; type?: unknown } }).error ?? {})
      : {};
  const identifier = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
  const code = identifier(error.code);
  const diagnostics = { httpStatus: status, providerCode: code, providerType: identifier(error.type) };

  if (code === "moderation_blocked" || code === "content_policy_violation") {
    return new AiPhotoProviderError("unsafe_output", "The image service declined this request.", diagnostics);
  }
  if (status === 401 || status === 403) {
    return new AiPhotoProviderError("provider_auth", "The image service rejected QOS credentials.", diagnostics);
  }
  if (status === 429) {
    return new AiPhotoProviderError(
      "provider_rate_limited",
      "The image service is busy. Try again later.",
      diagnostics,
      classifyProviderFailure("rejected", { retryable: true, retryAfterMs: parseRetryAfterMs(headers) }),
    );
  }
  // A 5xx does not prove the image was not generated and billed.
  return new AiPhotoProviderError(
    "provider_error",
    "The image service could not generate this photo.",
    diagnostics,
    classifyProviderFailure(status >= 500 ? "submission_unknown" : "rejected"),
  );
}

export function createOpenAiPhotoProvider(options: {
  apiKey: string;
  model: string;
  quality: AiPhotoQuality;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): AiPhotoProvider {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  return {
    kind: "openai",
    capabilities: {
      network: true,
      // X-Client-Request-Id is a correlation id, not a documented idempotency key.
      submitIdempotency: "none",
      usageReporting: true,
      internalRetries: 0,
    },
    async generate(request) {
      let response: Response;
      try {
        response = await fetchImpl(OPENAI_IMAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "X-Client-Request-Id": request.requestId,
          },
          body: JSON.stringify({
            model: options.model,
            prompt: request.prompt,
            n: 1,
            size: "1024x1024",
            quality: options.quality,
            output_format: "jpeg",
          }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new AiPhotoProviderError("provider_timeout", "The image service took too long to respond.");
        }
        throw new AiPhotoProviderError(
          "provider_unreachable",
          "The image service could not be reached.",
          null,
          connectFailureCode(error)
            ? classifyProviderFailure("not_dispatched", { retryable: true })
            : classifyProviderFailure("submission_unknown"),
        );
      }

      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) {
        throw new AiPhotoProviderError("invalid_output", "The image service returned an oversized response.");
      }

      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      if (!response.ok) {
        throw errorFromResponse(response.status, body, response.headers);
      }

      const first =
        body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
          ? ((body as { data: unknown[] }).data[0] as { b64_json?: unknown } | undefined)
          : undefined;
      if (!first || typeof first.b64_json !== "string" || first.b64_json.length === 0) {
        throw new AiPhotoProviderError("invalid_output", "The image service returned no image.");
      }

      return {
        bytes: Buffer.from(first.b64_json, "base64"),
        model: options.model,
        usage: readUsage((body as { usage?: unknown }).usage),
      };
    },
  };
}
