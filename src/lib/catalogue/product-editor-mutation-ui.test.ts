import { describe, expect, it } from "vitest";

import {
  productEditorCanRemovePrimaryPhoto,
  productEditorChildMutationsDisabled,
} from "./product-editor-mutation-ui";

describe("productEditorMutationUi", () => {
  it("disables child mutations for archived products only", () => {
    expect(productEditorChildMutationsDisabled("archived")).toBe(true);
    expect(productEditorChildMutationsDisabled("draft")).toBe(false);
    expect(productEditorChildMutationsDisabled("active")).toBe(false);
    expect(productEditorChildMutationsDisabled(null)).toBe(false);
  });

  it("allows removing primary photos for draft and active products", () => {
    expect(productEditorCanRemovePrimaryPhoto("draft")).toBe(true);
    expect(productEditorCanRemovePrimaryPhoto("active")).toBe(true);
    expect(productEditorCanRemovePrimaryPhoto("archived")).toBe(false);
    expect(productEditorCanRemovePrimaryPhoto(null)).toBe(true);
  });
});
