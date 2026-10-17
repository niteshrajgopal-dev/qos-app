import { describe, expect, it } from "vitest";

import { shouldShowArchiveDraftProductAction } from "@/lib/catalogue/product-archive-action";

describe("shouldShowArchiveDraftProductAction", () => {
  it("is visible only for draft products when the caller is an administrator", () => {
    expect(shouldShowArchiveDraftProductAction("draft", true)).toBe(true);
    expect(shouldShowArchiveDraftProductAction("draft", false)).toBe(false);
    expect(shouldShowArchiveDraftProductAction("active", true)).toBe(false);
    expect(shouldShowArchiveDraftProductAction("archived", true)).toBe(false);
  });
});
