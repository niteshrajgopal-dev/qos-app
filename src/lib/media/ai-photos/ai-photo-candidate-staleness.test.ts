import { describe, expect, it } from "vitest";

import { isAiPhotoCandidateStale } from "@/lib/media/ai-photos/ai-photo-candidate-staleness";
import { aiPhotoContextSha256 } from "@/lib/media/ai-photos/prompt";

const context = { displayName: "Latte", description: "Milk", sectionName: "Coffee" };

describe("isAiPhotoCandidateStale", () => {
  it("treats a context hash mismatch as stale", () => {
    expect(
      isAiPhotoCandidateStale({
        metadata: { contextSha256: "deadbeef", productVersion: 3 },
        product: { version: 3, context },
      }),
    ).toBe(true);
  });

  it("treats a product version mismatch as stale when productVersion was recorded", () => {
    const contextSha256 = aiPhotoContextSha256(context);
    expect(
      isAiPhotoCandidateStale({
        metadata: { contextSha256, productVersion: 2 },
        product: { version: 3, context },
      }),
    ).toBe(true);
  });

  it("allows legacy candidates without productVersion when the context hash still matches", () => {
    const contextSha256 = aiPhotoContextSha256(context);
    expect(
      isAiPhotoCandidateStale({
        metadata: { contextSha256 },
        product: { version: 99, context },
      }),
    ).toBe(false);
  });

  it("refuses legacy candidates when the context hash changes", () => {
    expect(
      isAiPhotoCandidateStale({
        metadata: { contextSha256: aiPhotoContextSha256(context) },
        product: {
          version: 1,
          context: { ...context, description: "Changed" },
        },
      }),
    ).toBe(true);
  });
});
