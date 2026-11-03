import { describe, expect, it } from "vitest";

import {
  PRODUCT_EDITOR_SECTION_IDS,
  PRODUCT_EDITOR_SECTIONS,
  productEditorSectionsForMode,
} from "@/app/tenants/[tenantId]/catalogue/products/product-editor-sections";
import { STAFF_UI_COPY } from "@/lib/staff/locale";

describe("product editor sections", () => {
  it("lists sections in the required order", () => {
    expect([...PRODUCT_EDITOR_SECTION_IDS]).toEqual([
      "identity",
      "english",
      "arabic",
      "pricing",
      "media",
      "variants",
      "modifier-groups",
      "status",
    ]);
    expect(PRODUCT_EDITOR_SECTIONS.map((section) => section.id)).toEqual([
      ...PRODUCT_EDITOR_SECTION_IDS,
    ]);
  });

  it("maps every section title and helper to staff UI copy in EN and AR", () => {
    for (const section of PRODUCT_EDITOR_SECTIONS) {
      expect(STAFF_UI_COPY.en[section.titleKey]).toBeTruthy();
      expect(STAFF_UI_COPY.ar[section.titleKey]).toBeTruthy();
      expect(STAFF_UI_COPY.en[section.helperKey]).toBeTruthy();
      expect(STAFF_UI_COPY.ar[section.helperKey]).toBeTruthy();
    }
  });

  it("hides edit-only sections on the new-product flow", () => {
    expect(productEditorSectionsForMode(false).map((section) => section.id)).toEqual([
      "identity",
      "english",
      "arabic",
      "pricing",
    ]);
    expect(productEditorSectionsForMode(true).map((section) => section.id)).toEqual([
      ...PRODUCT_EDITOR_SECTION_IDS,
    ]);
  });
});
