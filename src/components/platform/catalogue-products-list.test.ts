import { describe, expect, it } from "vitest";

import { publicProductThumbnailUrl } from "./catalogue-products-list";

describe("publicProductThumbnailUrl", () => {
  it("uses the same public media path as the storefront", () => {
    expect(publicProductThumbnailUrl("mda_thumb_01")).toBe(
      "/api/public/media/mda_thumb_01",
    );
  });
});
