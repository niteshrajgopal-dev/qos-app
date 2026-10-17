import { describe, expect, it } from "vitest";

import {
  productEditorIsReadOnly,
  productEditorPageTitle,
  productEditorSaveLabel,
} from "./product-editor-copy";

describe("productEditorCopy", () => {
  it("selects status-appropriate English titles and save labels", () => {
    expect(productEditorPageTitle("draft", "en")).toBe("Edit draft product");
    expect(productEditorPageTitle("active", "en")).toBe("Edit active product");
    expect(productEditorPageTitle("archived", "en")).toBe("View archived product");

    expect(productEditorSaveLabel("draft", "en", false)).toBe("Save draft");
    expect(productEditorSaveLabel("active", "en", false)).toBe("Save changes");
    expect(productEditorSaveLabel("active", "en", true)).toBe("Saving…");
  });

  it("selects status-appropriate Arabic titles and save labels", () => {
    expect(productEditorPageTitle("active", "ar")).toBe("تعديل منتج نشط");
    expect(productEditorSaveLabel("draft", "ar", false)).toBe("حفظ المسودة");
    expect(productEditorSaveLabel("active", "ar", false)).toBe("حفظ التغييرات");
  });

  it("treats archived products as read-only in the editor", () => {
    expect(productEditorIsReadOnly("archived")).toBe(true);
    expect(productEditorIsReadOnly("draft")).toBe(false);
    expect(productEditorIsReadOnly("active")).toBe(false);
  });
});
