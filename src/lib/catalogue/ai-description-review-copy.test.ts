import { describe, expect, it } from "vitest";

import { AI_DESCRIPTION_REVIEW_ACCEPTED_COPY } from "@/lib/catalogue/ai-description-review-copy";

describe("AI description accepted copy", () => {
  it("states that accept saves draft catalogue copy and still needs administrator approval", () => {
    expect(AI_DESCRIPTION_REVIEW_ACCEPTED_COPY.en.toLowerCase()).toContain("catalogue");
    expect(AI_DESCRIPTION_REVIEW_ACCEPTED_COPY.en.toLowerCase()).toContain("administrator");
    expect(AI_DESCRIPTION_REVIEW_ACCEPTED_COPY.en).not.toContain("product draft");
    expect(AI_DESCRIPTION_REVIEW_ACCEPTED_COPY.ar.length).toBeGreaterThan(10);
  });
});
