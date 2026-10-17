import { describe, expect, it } from "vitest";

import { productEditorChildMutationsDisabled } from "./product-editor-mutation-ui";

describe("productEditorMutationUi", () => {
  it("disables child mutations for archived products only", () => {
    expect(productEditorChildMutationsDisabled("archived")).toBe(true);
    expect(productEditorChildMutationsDisabled("draft")).toBe(false);
    expect(productEditorChildMutationsDisabled("active")).toBe(false);
    expect(productEditorChildMutationsDisabled(null)).toBe(false);
  });
});
