import { describe, expect, it } from "vitest";

import { shouldShowDescriptionAcceptedBanner } from "@/lib/catalogue/ai-description-review-ui";

describe("AI description accepted banner", () => {
  it("does not show on load when a prior run was accepted", () => {
    expect(shouldShowDescriptionAcceptedBanner("accepted", false)).toBe(false);
  });

  it("shows only after accept succeeds in this session", () => {
    expect(shouldShowDescriptionAcceptedBanner("accepted", true)).toBe(true);
    expect(shouldShowDescriptionAcceptedBanner("pending", true)).toBe(false);
  });
});
