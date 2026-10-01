import type { AiPhotoConfig, AiPhotoQuality } from "@/lib/media/ai-photos/config";

export type AiPhotoGenerationRequest = {
  prompt: string;
  /** Stable per candidate so a transport retry is attributable to one spend record. */
  requestId: string;
};

export type AiPhotoUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiPhotoGenerationResult = {
  bytes: Buffer;
  model: string;
  usage: AiPhotoUsage | null;
};

export interface AiPhotoProvider {
  readonly kind: string;
  generate(request: AiPhotoGenerationRequest): Promise<AiPhotoGenerationResult>;
}

export class AiPhotoProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AiPhotoProviderError";
    this.code = code;
  }
}

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
/** Upper bound on the base64 body we will buffer (a 1024px JPEG is far smaller). */
const MAX_RESPONSE_CHARS = 20_000_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

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

/**
 * Maps a provider error body to a stable code. Provider messages are not
 * passed through: they can echo prompt text and are not staff-facing copy.
 */
function errorFromResponse(status: number, body: unknown): AiPhotoProviderError {
  const error =
    body && typeof body === "object" && "error" in body
      ? ((body as { error?: { code?: unknown } }).error ?? {})
      : {};
  const code = typeof error.code === "string" ? error.code : null;

  if (code === "moderation_blocked" || code === "content_policy_violation") {
    return new AiPhotoProviderError("unsafe_output", "The image service declined this request.");
  }
  if (status === 401 || status === 403) {
    return new AiPhotoProviderError("provider_auth", "The image service rejected QOS credentials.");
  }
  if (status === 429) {
    return new AiPhotoProviderError("provider_rate_limited", "The image service is busy. Try again later.");
  }
  return new AiPhotoProviderError("provider_error", "The image service could not generate this photo.");
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
        throw new AiPhotoProviderError("provider_unreachable", "The image service could not be reached.");
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
        throw errorFromResponse(response.status, body);
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

let providerOverride: AiPhotoProvider | null = null;

/** Tests inject a fake so no paid provider is ever called. */
export function setAiPhotoProviderForTesting(provider: AiPhotoProvider | null) {
  providerOverride = provider;
}

export function hasAiPhotoProviderOverride() {
  return providerOverride !== null;
}

export function getAiPhotoProvider(config: AiPhotoConfig): AiPhotoProvider {
  if (providerOverride) {
    return providerOverride;
  }
  if (!config.openAiApiKey) {
    throw new AiPhotoProviderError("provider_unavailable", "AI photos are not configured.");
  }
  return createOpenAiPhotoProvider({
    apiKey: config.openAiApiKey,
    model: config.model,
    quality: config.quality,
    timeoutMs: config.requestTimeoutMs,
  });
}
