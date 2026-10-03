import { createHash } from "node:crypto";

import sharp from "sharp";

import type { AiPhotoConfig } from "@/lib/media/ai-photos/config";
import { createOpenAiPhotoProvider } from "@/lib/media/ai-photos/openai-photo-provider";
import { AiPhotoProviderError, type AiPhotoProvider } from "@/lib/media/ai-photos/provider-contract";

export {
  AiPhotoProviderError,
  defaultAiPhotoFailureClassification,
  type AiPhotoGenerationRequest,
  type AiPhotoGenerationResult,
  type AiPhotoProvider,
  type AiPhotoProviderCapabilities,
  type AiPhotoProviderDiagnostics,
  type AiPhotoUsage,
} from "@/lib/media/ai-photos/provider-contract";

/** Local development stand-in: a deterministic placeholder per prompt, no network. */
export function createMockAiPhotoProvider(): AiPhotoProvider {
  return {
    kind: "mock",
    capabilities: {
      network: false,
      submitIdempotency: "none",
      usageReporting: false,
      internalRetries: 0,
    },
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
