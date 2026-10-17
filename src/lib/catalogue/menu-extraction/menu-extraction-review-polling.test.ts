import { describe, expect, it } from "vitest";

import {
  isTerminalMenuExtractionRun,
  shouldPollMenuExtractionReview,
} from "@/lib/catalogue/menu-extraction/menu-extraction-review-polling";

describe("menu extraction review polling", () => {
  it("polls while queued or running", () => {
    expect(shouldPollMenuExtractionReview("queued")).toBe(true);
    expect(shouldPollMenuExtractionReview("running")).toBe(true);
    expect(shouldPollMenuExtractionReview("failed")).toBe(false);
  });

  it("treats failed and completed as terminal", () => {
    expect(isTerminalMenuExtractionRun("failed")).toBe(true);
    expect(isTerminalMenuExtractionRun("completed")).toBe(true);
    expect(isTerminalMenuExtractionRun("queued")).toBe(false);
  });
});
