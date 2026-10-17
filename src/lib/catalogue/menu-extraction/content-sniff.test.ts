import { describe, expect, it } from "vitest";

import { resolveMenuExtractionMimeType, sniffMenuExtractionMimeType } from "@/lib/catalogue/menu-extraction/content-sniff";

describe("menu extraction content sniffing", () => {
  it("detects PDF magic bytes even when the filename is misleading", () => {
    const bytes = Buffer.from("%PDF-1.4 fake body");
    expect(sniffMenuExtractionMimeType(bytes)).toBe("application/pdf");
    expect(resolveMenuExtractionMimeType("menu.png", "image/png", bytes)).toBe("application/pdf");
  });
});
