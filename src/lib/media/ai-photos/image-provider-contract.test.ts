import { createOpenAiPhotoProvider, type FetchLike } from "@/lib/media/ai-photos/openai-photo-provider";
import { createMockAiPhotoProvider } from "@/lib/media/ai-photos/provider";
import type { AiPhotoProvider } from "@/lib/media/ai-photos/provider-contract";
import { describeImageProviderContract } from "@/lib/media/ai-photos/testing/image-provider-contract";

describeImageProviderContract("OpenAI adapter (fetch faked)", {
  build() {
    let dispatches = 0;
    const fetchImpl: FetchLike = async () => {
      dispatches += 1;
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("fake-jpeg-bytes").toString("base64") }],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        }),
        { status: 200 },
      );
    };
    return {
      provider: createOpenAiPhotoProvider({
        apiKey: "sk-contract",
        model: "gpt-image-1",
        quality: "low",
        timeoutMs: 1_000,
        fetchImpl,
      }),
      dispatches: () => dispatches,
    };
  },
});

describeImageProviderContract("mock provider", {
  build() {
    return { provider: createMockAiPhotoProvider(), dispatches: () => null };
  },
});

describeImageProviderContract("test fake", {
  build() {
    const provider: AiPhotoProvider = {
      kind: "fake",
      capabilities: { network: false, submitIdempotency: "none", usageReporting: false, internalRetries: 0 },
      async generate() {
        return { bytes: Buffer.from("fake"), model: "fake-model", usage: null };
      },
    };
    return { provider, dispatches: () => null };
  },
});
