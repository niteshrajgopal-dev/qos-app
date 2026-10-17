import { describe, expect, it } from "vitest";

import {
  adminReviewApprovalFieldsFromSnapshot,
  translationTextMatchesLastApproved,
} from "@/lib/catalogue/translation-admin-review-snapshot";

describe("adminReviewApprovalFieldsFromSnapshot", () => {
  it("restores approval metadata when the accept snapshot captured it", () => {
    const approvedAt = new Date("2026-09-18T16:17:24.000Z");
    expect(
      adminReviewApprovalFieldsFromSnapshot({
        adminReviewRevertCapturesApprovalFields: true,
        adminReviewRevertApprovedBySubject: "ops@test",
        adminReviewRevertApprovedAt: approvedAt,
        adminReviewRevertApprovedTranslationVersion: 1,
        adminReviewRevertApprovedSourceTranslationVersion: 1,
      }),
    ).toEqual({
      approvedBySubject: "ops@test",
      approvedAt: approvedAt,
      approvedTranslationVersion: 1,
      approvedSourceTranslationVersion: 1,
    });
  });

  it("clears approval metadata for legacy snapshots without the capture flag", () => {
    expect(
      adminReviewApprovalFieldsFromSnapshot({
        adminReviewRevertCapturesApprovalFields: false,
        adminReviewRevertApprovedBySubject: "ops@test",
        adminReviewRevertApprovedAt: new Date(),
        adminReviewRevertApprovedTranslationVersion: 1,
        adminReviewRevertApprovedSourceTranslationVersion: 1,
      }),
    ).toEqual({
      approvedBySubject: null,
      approvedAt: null,
      approvedTranslationVersion: null,
      approvedSourceTranslationVersion: null,
    });
  });
});

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
