import { describe, expect, it } from "vitest";

import { shouldShowTranslationAcceptedBanner } from "@/lib/catalogue/ai-translation-review-ui";

describe("shouldShowTranslationAcceptedBanner", () => {
  it("hides the accepted banner until the user accepts in this session", () => {
    expect(shouldShowTranslationAcceptedBanner("accepted", false)).toBe(false);
  });

  it("shows the accepted banner only after accept in this session", () => {
    expect(shouldShowTranslationAcceptedBanner("accepted", true)).toBe(true);
    expect(shouldShowTranslationAcceptedBanner("pending", true)).toBe(false);
  });
});
