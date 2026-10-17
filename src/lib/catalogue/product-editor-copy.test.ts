import { describe, expect, it } from "vitest";

import {
  productEditorIsReadOnly,
  productEditorLoadPrompt,
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
    expect(productEditorPageTitle("draft", "ar")).toBe("تعديل مسودة المنتج");
    expect(productEditorPageTitle("active", "ar")).toBe("تعديل منتج نشط");
    expect(productEditorPageTitle("archived", "ar")).toBe("عرض منتج مؤرشف");
    expect(productEditorSaveLabel("draft", "ar", false)).toBe("حفظ المسودة");
    expect(productEditorSaveLabel("active", "ar", false)).toBe("حفظ التغييرات");
  });

  it("selects status-appropriate load prompts in English and Arabic", () => {
    expect(productEditorLoadPrompt("active", "en")).toBe(
      "Load the product to begin editing.",
    );
    expect(productEditorLoadPrompt("archived", "en")).toBe(
      "Load the archived product to view its details.",
    );
    expect(productEditorLoadPrompt("draft", "en")).toBe(
      "Load the draft product to begin editing.",
    );
    expect(productEditorLoadPrompt(null, "en")).toBe(
      "Load the draft product to begin editing.",
    );

    expect(productEditorLoadPrompt("archived", "ar")).toBe(
      "حمّل المنتج المؤرشف لعرض التفاصيل.",
    );
    expect(productEditorLoadPrompt("active", "ar")).toBe(
      "حمّل المنتج لبدء التعديل.",
    );
  });

  it("treats archived products as read-only in the editor", () => {
    expect(productEditorIsReadOnly("archived")).toBe(true);
    expect(productEditorIsReadOnly("draft")).toBe(false);
    expect(productEditorIsReadOnly("active")).toBe(false);
  });
});
