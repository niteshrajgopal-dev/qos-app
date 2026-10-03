import { describe, expect, it } from "vitest";

import { permitsAutomaticResubmission, type ProviderOutcome } from "@/lib/ai/provider-outcome";
import { createOpenAiPhotoProvider, type FetchLike } from "@/lib/media/ai-photos/openai-photo-provider";
import {
  AiPhotoProviderError,
  defaultAiPhotoFailureClassification,
} from "@/lib/media/ai-photos/provider-contract";

const API_KEY = "sk-secret-never-echoed";
const PROMPT = "Prompt text that must never be echoed";

function adapter(fetchImpl: FetchLike) {
  return createOpenAiPhotoProvider({
    apiKey: API_KEY,
    model: "gpt-image-1",
    quality: "low",
    timeoutMs: 1_000,
    fetchImpl,
  });
}

function connectionError(code: string) {
  return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
}

type Case = {
  name: string;
  respond: () => Promise<Response>;
  code: string;
  outcome: ProviderOutcome;
  retryable: boolean;
  retryAfterMs?: number | null;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  async () => new Response(JSON.stringify(body), { status, headers });

const CASES: Case[] = [
  {
    name: "refused connection (provably not sent)",
    respond: async () => {
      throw connectionError("ECONNREFUSED");
    },
    code: "provider_unreachable",
    outcome: "not_dispatched",
    retryable: true,
  },
  {
    name: "DNS failure (provably not sent)",
    respond: async () => {
      throw connectionError("ENOTFOUND");
    },
    code: "provider_unreachable",
    outcome: "not_dispatched",
    retryable: true,
  },
  {
    name: "connection reset after send",
    respond: async () => {
      throw connectionError("ECONNRESET");
    },
    code: "provider_unreachable",
    outcome: "submission_unknown",
    retryable: false,
  },
  {
    name: "timeout",
    respond: async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
    code: "provider_timeout",
    outcome: "submission_unknown",
    retryable: false,
  },
  {
    name: "HTTP 500",
    respond: json(500, { error: { code: "server_error", message: PROMPT } }),
    code: "provider_error",
    outcome: "submission_unknown",
    retryable: false,
  },
  {
    name: "HTTP 400",
    respond: json(400, { error: { code: "invalid_value", message: PROMPT } }),
    code: "provider_error",
    outcome: "rejected",
    retryable: false,
  },
  {
    name: "HTTP 401",
    respond: json(401, { error: { code: "invalid_api_key", message: `bad key ${API_KEY}` } }),
    code: "provider_auth",
    outcome: "rejected",
    retryable: false,
  },
  {
    name: "HTTP 429 with Retry-After",
    respond: json(429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": "3" }),
    code: "provider_rate_limited",
    outcome: "rejected",
    retryable: true,
    retryAfterMs: 3_000,
  },
  {
    name: "moderation refusal",
    respond: json(400, { error: { code: "moderation_blocked", message: PROMPT } }),
    code: "unsafe_output",
    outcome: "failed_after_processing",
    retryable: false,
  },
  {
    name: "success status without an image",
    respond: json(200, { data: [] }),
    code: "invalid_output",
    outcome: "failed_after_processing",
    retryable: false,
  },
];

describe("OpenAI image adapter failure classification", () => {
  it.each(CASES)("$name", async ({ respond, code, outcome, retryable, retryAfterMs }) => {
    let dispatches = 0;
    const provider = adapter(async () => {
      dispatches += 1;
      return respond();
    });

    const error = await provider.generate({ prompt: PROMPT, requestId: "asset_1" }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(AiPhotoProviderError);
    const providerError = error as AiPhotoProviderError;
    expect(providerError.code).toBe(code);
    expect(providerError.classification).toEqual({
      outcome,
      retryable,
      retryAfterMs: retryAfterMs ?? null,
    });
    // One retry owner: the adapter itself never retries.
    expect(dispatches).toBe(1);
    // Neither the prompt nor the credential leaks into errors or diagnostics.
    const serialized = JSON.stringify({
      message: providerError.message,
      diagnostics: providerError.diagnostics,
    });
    expect(serialized).not.toContain(PROMPT);
    expect(serialized).not.toContain(API_KEY);
  });

  it("only allows automatic resubmission when the request provably did not run", () => {
    for (const { outcome, retryable, code } of CASES) {
      const error = new AiPhotoProviderError(code, "x", null, {
        outcome,
        retryable,
        retryAfterMs: null,
      });
      expect(permitsAutomaticResubmission(error.classification)).toBe(
        outcome === "not_dispatched" || (outcome === "rejected" && retryable),
      );
    }
  });

  it("classifies errors constructed without evidence conservatively", () => {
    expect(defaultAiPhotoFailureClassification("provider_unavailable").outcome).toBe("not_dispatched");
    expect(defaultAiPhotoFailureClassification("provider_unreachable").outcome).toBe("submission_unknown");
    expect(defaultAiPhotoFailureClassification("something_new").outcome).toBe("submission_unknown");
    expect(new AiPhotoProviderError("invalid_output", "x").outcome).toBe("failed_after_processing");
  });
});
