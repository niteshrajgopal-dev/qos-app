import { describe, expect, it } from "vitest";

import { menuExtractionExtractIdempotencyKey } from "@/lib/catalogue/menu-extraction/extract-idempotency";

describe("menuExtractionExtractIdempotencyKey", () => {
  it("scopes keys per source and supports explicit retries", () => {
    const sourceA = "src_aaaaaaaaaaaaaaaaaaaaaaaa";
    const sourceB = "src_bbbbbbbbbbbbbbbbbbbbbbbb";
    expect(menuExtractionExtractIdempotencyKey(sourceA)).toBe(
      `menu-extraction-extract:${sourceA}`,
    );
    expect(menuExtractionExtractIdempotencyKey(sourceB)).not.toBe(
      menuExtractionExtractIdempotencyKey(sourceA),
    );
    expect(menuExtractionExtractIdempotencyKey(sourceA, "nonce-1")).toBe(
      `menu-extraction-extract:${sourceA}:retry:nonce-1`,
    );
  });
});
