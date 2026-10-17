import { describe, expect, it } from "vitest";

import { menuExtractionRunStatusLabel } from "@/lib/catalogue/menu-extraction/menu-extraction-run-status";

describe("menuExtractionRunStatusLabel", () => {
  it("maps completed to ready in EN and AR", () => {
    expect(menuExtractionRunStatusLabel("completed", "en")).toBe("ready");
    expect(menuExtractionRunStatusLabel("completed", "ar")).toBe("جاهز");
    expect(menuExtractionRunStatusLabel("failed", "en")).toBe("failed");
  });
});
