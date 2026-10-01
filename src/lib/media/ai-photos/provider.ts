import { createHash } from "node:crypto";

import sharp from "sharp";

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

export type AiPhotoProviderDiagnostics = {
  httpStatus: number;
  /** Provider error `code` / `type` identifiers only; never the free-text message. */
  providerCode: string | null;
  providerType: string | null;
};

export class AiPhotoProviderError extends Error {
  readonly code: string;
  readonly diagnostics: AiPhotoProviderDiagnostics | null;

  constructor(code: string, message: string, diagnostics: AiPhotoProviderDiagnostics | null = null) {
    super(message);
    this.name = "AiPhotoProviderError";
    this.code = code;
    this.diagnostics = diagnostics;
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
    return new AiPhotoProviderError("provider_rate_limited", "The image service is busy. Try again later.", diagnostics);
  }
  return new AiPhotoProviderError("provider_error", "The image service could not generate this photo.", diagnostics);
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

/** Local development stand-in: a deterministic placeholder per prompt, no network. */
export function createMockAiPhotoProvider(): AiPhotoProvider {
  return {
    kind: "mock",
    async generate(request) {
      const digest = createHash("sha256").update(request.prompt).digest();
      const hue = (offset: number) => 80 + (digest[offset]! % 150);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <defs><radialGradient id="g"><stop offset="0" stop-color="rgb(${hue(0)},${hue(1)},${hue(2)})"/>
        <stop offset="1" stop-color="rgb(${hue(3)},${hue(4)},${hue(5)})"/></radialGradient></defs>
        <rect width="512" height="512" fill="#f4efe8"/>
        <circle cx="256" cy="256" r="190" fill="#ffffff"/>
        <circle cx="256" cy="256" r="150" fill="url(#g)"/></svg>`;
      return {
        bytes: await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer(),
        model: "mock",
        usage: null,
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
  if (config.provider === "mock") {
    return createMockAiPhotoProvider();
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
