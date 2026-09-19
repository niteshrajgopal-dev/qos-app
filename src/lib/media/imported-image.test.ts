import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { prepareImportedImageBytes } from "@/lib/media/imported-image";
import { validateImageBytes } from "@/lib/media/validation";

async function createJpeg(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("prepareImportedImageBytes", () => {
  it("does not resize a normal-sized image", async () => {
    const bytes = await createJpeg(64, 48);

    const prepared = await prepareImportedImageBytes(bytes, {
      maxPixelDimension: 4096,
    });

    expect(prepared.resized).toBe(false);
    expect(prepared.contentType).toBe("image/jpeg");
    expect(prepared.width).toBe(64);
    expect(prepared.height).toBe(48);
    expect(prepared.bytes.equals(bytes)).toBe(true);
  });

  it("downsamples an oversized image while preserving aspect ratio", async () => {
    const bytes = await createJpeg(5000, 1000);

    const prepared = await prepareImportedImageBytes(bytes, {
      maxPixelDimension: 4096,
    });
    const validated = await validateImageBytes(
      prepared.bytes,
      prepared.contentType,
    );

    expect(prepared.resized).toBe(true);
    expect(prepared.width).toBeLessThanOrEqual(4096);
    expect(prepared.height).toBeLessThanOrEqual(4096);
    expect(prepared.width / prepared.height).toBeCloseTo(5, 1);
    expect(validated.width).toBe(prepared.width);
    expect(validated.height).toBe(prepared.height);
  });

  it("leaves the strict pixel validator in place for unprepared uploads", async () => {
    const bytes = await createJpeg(5000, 200);

    await expect(validateImageBytes(bytes, "image/jpeg")).rejects.toThrow(
      /pixel limits/i,
    );
  });
});
