import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaffTranslationFieldRow } from "@/lib/catalogue/staff-translation-field-row";

describe("StaffTranslationFieldRow (AR)", () => {
  it("renders label and value in separate blocks with bdi for RTL values", () => {
    const html = renderToStaticMarkup(
      createElement(StaffTranslationFieldRow, {
        label: "Approved by",
        value: "—",
        dir: "rtl",
        labelDir: "ltr",
      }),
    );

    expect(html).toContain("Approved by");
    expect(html).toContain("<bdi");
    expect(html).toContain("—");
    expect(html).not.toContain(":Approved by");
    expect(html).not.toContain("Approved by:");
  });
});
