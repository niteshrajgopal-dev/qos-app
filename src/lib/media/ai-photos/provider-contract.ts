import {
  classifyProviderFailure,
  type ProviderFailureClassification,
  type ProviderOutcome,
} from "@/lib/ai/provider-outcome";

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

export type AiPhotoProviderCapabilities = {
  /** False for local stand-ins that never leave the process. */
  network: boolean;
  /** `none`: `requestId` is correlation only; a lost response cannot be deduplicated remotely. */
  submitIdempotency: "none" | "provider_key";
  usageReporting: boolean;
  /** QOS owns retries; adapters never retry internally. */
  internalRetries: 0;
};

export interface AiPhotoProvider {
  readonly kind: string;
  readonly capabilities: AiPhotoProviderCapabilities;
  generate(request: AiPhotoGenerationRequest): Promise<AiPhotoGenerationResult>;
}

export type AiPhotoProviderDiagnostics = {
  httpStatus: number;
  /** Provider error `code` / `type` identifiers only; never the free-text message. */
  providerCode: string | null;
  providerType: string | null;
};

/**
 * What each stable code proves when the adapter has no better evidence.
 * Unknown codes are treated as possibly accepted.
 */
const DEFAULT_OUTCOME_BY_CODE: Record<string, { outcome: ProviderOutcome; retryable?: boolean }> = {
  provider_unavailable: { outcome: "not_dispatched" },
  provider_auth: { outcome: "rejected" },
  provider_rate_limited: { outcome: "rejected", retryable: true },
  provider_timeout: { outcome: "submission_unknown" },
  provider_unreachable: { outcome: "submission_unknown" },
  provider_error: { outcome: "submission_unknown" },
  unsafe_output: { outcome: "failed_after_processing" },
  invalid_output: { outcome: "failed_after_processing" },
};

export function defaultAiPhotoFailureClassification(code: string) {
  const known = DEFAULT_OUTCOME_BY_CODE[code] ?? { outcome: "submission_unknown" as const };
  return classifyProviderFailure(known.outcome, { retryable: known.retryable });
}

export class AiPhotoProviderError extends Error {
  readonly code: string;
  readonly diagnostics: AiPhotoProviderDiagnostics | null;
  readonly classification: ProviderFailureClassification;

  constructor(
    code: string,
    message: string,
    diagnostics: AiPhotoProviderDiagnostics | null = null,
    classification: ProviderFailureClassification = defaultAiPhotoFailureClassification(code),
  ) {
    super(message);
    this.name = "AiPhotoProviderError";
    this.code = code;
    this.diagnostics = diagnostics;
    this.classification = classification;
  }

  get outcome(): ProviderOutcome {
    return this.classification.outcome;
  }
}
