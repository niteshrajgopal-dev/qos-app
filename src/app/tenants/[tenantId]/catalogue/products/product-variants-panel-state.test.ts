import { describe, expect, it } from "vitest";

import {
  productVariantControlDisabled,
  productVariantPriceDisabled,
  productVariantsPanelIsProductReadOnly,
  productVariantsPanelShowsAddForm,
} from "./product-variants-panel-state";

describe("productVariantsPanelState", () => {
  it("treats archived catalogue products as read-only in the variants panel", () => {
    expect(productVariantsPanelIsProductReadOnly("archived")).toBe(true);
    expect(productVariantsPanelIsProductReadOnly("draft")).toBe(false);
    expect(productVariantsPanelShowsAddForm(true)).toBe(false);
    expect(productVariantsPanelShowsAddForm(false)).toBe(true);
  });

  it("disables active variant controls when the parent product is archived", () => {
    expect(
      productVariantControlDisabled(true, false, false),
    ).toBe(true);
    expect(
      productVariantPriceDisabled(true, false, false, true),
    ).toBe(true);
    expect(
      productVariantControlDisabled(false, false, false),
    ).toBe(false);
  });
});
