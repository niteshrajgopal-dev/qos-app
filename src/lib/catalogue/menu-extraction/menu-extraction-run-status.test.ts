import { describe, expect, it } from "vitest";

import { menuExtractionRunStatusLabel } from "@/lib/catalogue/menu-extraction/menu-extraction-run-status";

describe("menuExtractionRunStatusLabel", () => {
  it("maps completed to ready in EN and AR", () => {
    expect(menuExtractionRunStatusLabel("completed", "en")).toBe("ready");
    expect(menuExtractionRunStatusLabel("completed", "ar")).toBe("جاهز");
    expect(menuExtractionRunStatusLabel("failed", "en")).toBe("failed");
    expect(menuExtractionRunStatusLabel("completed", "en", "rejected")).toBe("cancelled");
    expect(menuExtractionRunStatusLabel("completed", "ar", "rejected")).toBe("ملغى");
    expect(menuExtractionRunStatusLabel("completed", "en", "cancelled")).toBe("cancelled");
    expect(menuExtractionRunStatusLabel("completed", "ar", "cancelled")).toBe("ملغى");
  });
});
