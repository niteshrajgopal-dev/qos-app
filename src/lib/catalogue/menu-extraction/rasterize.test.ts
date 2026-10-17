import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MENU_EXTRACTION_LIMITS } from "@/lib/catalogue/menu-extraction/config";
import { rasterizeMenuUpload } from "@/lib/catalogue/menu-extraction/rasterize";

describe("menu extraction rasterize", () => {
  it("renders a synthetic PDF with an embedded image without crashing", async () => {
    const fixturePath = path.join(
      process.cwd(),
      "fixtures/menu-extraction/synthetic/en-text-menu-with-image.pdf",
    );
    const bytes = await readFile(fixturePath);
    const rasterized = await rasterizeMenuUpload(bytes, MENU_EXTRACTION_LIMITS.allowedPdfMimeType, {
      maxPixelDimension: MENU_EXTRACTION_LIMITS.maxPixelDimension,
      maxUploadBytes: MENU_EXTRACTION_LIMITS.maxUploadBytes,
      maxPages: MENU_EXTRACTION_LIMITS.maxPages,
    });
    expect(rasterized.pages.length).toBeGreaterThan(0);
    expect(rasterized.pages[0]?.bytes.byteLength).toBeGreaterThan(100);
    expect(rasterized.pages[0]?.mimeType).toBe("image/jpeg");
  });
});
