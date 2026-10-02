import { describe, expect, it } from "vitest";

import { aiPhotoUnavailableReason, readAiPhotoConfig } from "@/lib/media/ai-photos/config";
import { aiPhotoContextSha256, buildAiPhotoPrompt } from "@/lib/media/ai-photos/prompt";
import sharp from "sharp";

import { createOpenAiPhotoProvider } from "@/lib/media/ai-photos/openai-photo-provider";
import {
  AiPhotoProviderError,
  createMockAiPhotoProvider,
} from "@/lib/media/ai-photos/provider";

describe("readAiPhotoConfig", () => {
  it("is off by default and unavailable without a key", () => {
    const config = readAiPhotoConfig({});
    expect(config).toMatchObject({ enabled: false, model: "gpt-image-1", quality: "low", dailyLimitPerTenant: 20 });
    expect(aiPhotoUnavailableReason(config)).toBe("disabled");
    expect(aiPhotoUnavailableReason(readAiPhotoConfig({ AI_PHOTOS_ENABLED: "true" }))).toBe("not_configured");
    expect(
      aiPhotoUnavailableReason(readAiPhotoConfig({ AI_PHOTOS_ENABLED: "true", OPENAI_API_KEY: "sk-test" })),
    ).toBeNull();
  });

  it("allows the mock provider only outside production and without a key", () => {
    const mock = readAiPhotoConfig({ AI_PHOTOS_ENABLED: "true", AI_PHOTO_PROVIDER: "mock" });
    expect(aiPhotoUnavailableReason(mock)).toBeNull();
    expect(() => readAiPhotoConfig({ AI_PHOTO_PROVIDER: "mock", NODE_ENV: "production" })).toThrow(/local development/);
    expect(() => readAiPhotoConfig({ AI_PHOTO_PROVIDER: "other" })).toThrow(/AI_PHOTO_PROVIDER/);
  });

  it("bounds the daily limit and rejects unapproved models", () => {
    expect(readAiPhotoConfig({ AI_PHOTO_DAILY_LIMIT_PER_TENANT: "100000" }).dailyLimitPerTenant).toBe(500);
    expect(readAiPhotoConfig({ AI_PHOTO_DAILY_LIMIT_PER_TENANT: "-3" }).dailyLimitPerTenant).toBe(20);
    expect(() => readAiPhotoConfig({ AI_PHOTO_MODEL: "dall-e-2" })).toThrow(/gpt-image/);
    expect(() => readAiPhotoConfig({ AI_PHOTO_QUALITY: "ultra" })).toThrow(/AI_PHOTO_QUALITY/);
  });
});

describe("buildAiPhotoPrompt", () => {
  it("uses the approved text as quoted data and strips control characters", () => {
    const prompt = buildAiPhotoPrompt({
      displayName: "Karak\u0000 tea\u202e",
      description: "Spiced milk tea",
      sectionName: "Hot drinks",
    });
    expect(prompt).toContain('Menu item name: "Karak tea".');
    expect(prompt).toContain('Menu description: "Spiced milk tea".');
    expect(prompt).toContain('Menu section: "Hot drinks".');
    expect(prompt).toContain("No text, lettering, logos");
  });

  it("fingerprints only the name and description", () => {
    const base = { displayName: "Latte", description: "Milk", sectionName: "Coffee" };
    expect(aiPhotoContextSha256(base)).toBe(aiPhotoContextSha256({ ...base, sectionName: "Other" }));
    expect(aiPhotoContextSha256(base)).not.toBe(aiPhotoContextSha256({ ...base, description: "Oat milk" }));
  });
});

describe("createOpenAiPhotoProvider", () => {
  function provider(response: Response, capture?: (init: RequestInit) => void) {
    return createOpenAiPhotoProvider({
      apiKey: "sk-test",
      model: "gpt-image-1",
      quality: "low",
      timeoutMs: 10_000,
      fetchImpl: async (_url, init) => {
        capture?.(init);
        return response;
      },
    });
  }

  it("sends one bounded jpeg request and decodes the image", async () => {
    let sent: Record<string, unknown> = {};
    const result = await provider(
      Response.json({ data: [{ b64_json: Buffer.from("img").toString("base64") }], usage: { total_tokens: 7 } }),
      (init) => {
        sent = JSON.parse(String(init.body));
      },
    ).generate({ prompt: "p", requestId: "mas_1" });

    expect(sent).toEqual({ model: "gpt-image-1", prompt: "p", n: 1, size: "1024x1024", quality: "low", output_format: "jpeg" });
    expect(result.bytes.toString()).toBe("img");
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: 7 });
  });

  it("maps provider errors to stable codes without echoing provider text", async () => {
    const blocked = provider(
      Response.json({ error: { code: "moderation_blocked", message: "secret prompt echo" } }, { status: 400 }),
    ).generate({ prompt: "p", requestId: "mas_1" });
    await expect(blocked).rejects.toMatchObject({ code: "unsafe_output" });
    await expect(blocked).rejects.not.toMatchObject({ message: expect.stringContaining("secret") });

    await expect(
      provider(Response.json({}, { status: 429 })).generate({ prompt: "p", requestId: "mas_1" }),
    ).rejects.toMatchObject({ code: "provider_rate_limited" });
    await expect(
      provider(Response.json({ data: [] })).generate({ prompt: "p", requestId: "mas_1" }),
    ).rejects.toBeInstanceOf(AiPhotoProviderError);
  });

  it("keeps the HTTP status and provider error identifiers for diagnosis, but not the message", async () => {
    const rejected = provider(
      Response.json(
        { error: { code: "invalid_api_key", type: "invalid_request_error", message: "Incorrect API key sk-****abcd" } },
        { status: 401 },
      ),
    ).generate({ prompt: "p", requestId: "mas_1" });

    const error = (await rejected.catch((caught: unknown) => caught)) as AiPhotoProviderError;
    expect(error.code).toBe("provider_auth");
    expect(error.diagnostics).toEqual({
      httpStatus: 401,
      providerCode: "invalid_api_key",
      providerType: "invalid_request_error",
    });
    expect(JSON.stringify(error.diagnostics)).not.toContain("sk-");

    const unverified = (await provider(
      Response.json({ error: { code: null, type: "invalid_request_error", message: "must be verified" } }, { status: 403 }),
    )
      .generate({ prompt: "p", requestId: "mas_1" })
      .catch((caught: unknown) => caught)) as AiPhotoProviderError;
    expect(unverified.diagnostics).toEqual({ httpStatus: 403, providerCode: null, providerType: "invalid_request_error" });
  });
});

describe("createMockAiPhotoProvider", () => {
  it("renders a decodable jpeg without any network call", async () => {
    const result = await createMockAiPhotoProvider().generate({ prompt: "Latte", requestId: "mas_1" });
    expect((await sharp(result.bytes).metadata()).format).toBe("jpeg");
  });
});
