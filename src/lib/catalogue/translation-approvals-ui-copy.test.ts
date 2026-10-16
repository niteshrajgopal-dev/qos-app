import { describe, expect, it } from "vitest";

import { translationApprovalsCopy } from "@/lib/catalogue/translation-approvals-ui-copy";

describe("translation approvals UI copy", () => {
  it("provides English and Arabic strings for the approvals screen", () => {
    expect(translationApprovalsCopy("en").approve).toBe("Approve");
    expect(translationApprovalsCopy("ar").approve).toBe("موافقة");
    expect(translationApprovalsCopy("en").intro).toContain("AI");
  });
});
