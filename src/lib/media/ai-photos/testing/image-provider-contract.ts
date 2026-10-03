import { describe, expect, it } from "vitest";

import type { AiPhotoProvider } from "@/lib/media/ai-photos/provider-contract";

export type ImageProviderHarness = {
  build(): {
    provider: AiPhotoProvider;
    /** Requests that reached the (faked) transport; null for providers with no transport. */
    dispatches(): number | null;
  };
};

const REQUEST = { prompt: "A plate of hummus, studio light.", requestId: "asset_contract_1" };

/**
 * Behaviour every `AiPhotoProvider` must share. Run against each real adapter
 * (transport faked) and every stand-in, so tests using a fake exercise the
 * same contract production relies on.
 */
export function describeImageProviderContract(label: string, harness: ImageProviderHarness) {
  describe(`AiPhotoProvider contract: ${label}`, () => {
    it("declares capabilities, with QOS as the only retry owner", () => {
      const { provider } = harness.build();
      expect(provider.kind).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(provider.capabilities.internalRetries).toBe(0);
      expect(["none", "provider_key"]).toContain(provider.capabilities.submitIdempotency);
    });

    it("returns non-empty image bytes and the model that produced them", async () => {
      const { provider } = harness.build();
      const result = await provider.generate(REQUEST);
      expect(Buffer.isBuffer(result.bytes)).toBe(true);
      expect(result.bytes.length).toBeGreaterThan(0);
      expect(result.model.length).toBeGreaterThan(0);
      if (!provider.capabilities.usageReporting) {
        expect(result.usage).toBeNull();
      }
    });

    it("dispatches at most once per generate, and only if it uses the network", async () => {
      const built = harness.build();
      await built.provider.generate(REQUEST);
      const dispatches = built.dispatches();
      if (built.provider.capabilities.network) {
        expect(dispatches).toBe(1);
      } else {
        expect(dispatches ?? 0).toBe(0);
      }
    });
  });
}
