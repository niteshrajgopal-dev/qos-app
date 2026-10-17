import { describe, expect, it } from "vitest";

import { translationTextMatchesLastApproved } from "@/lib/catalogue/translation-admin-review-snapshot";

describe("translationTextMatchesLastApproved", () => {
  it("matches trimmed display name and description against last approved copy", () => {
    expect(
      translationTextMatchesLastApproved(
        {
          lastApprovedDisplayName: "Spanish latte",
          lastApprovedDescription: null,
        },
        "Spanish latte",
        null,
      ),
    ).toBe(true);
  });

  it("does not match when last approved copy was never recorded", () => {
    expect(
      translationTextMatchesLastApproved(
        {
          lastApprovedDisplayName: null,
          lastApprovedDescription: null,
        },
        "Spanish latte",
        null,
      ),
    ).toBe(false);
  });
});
