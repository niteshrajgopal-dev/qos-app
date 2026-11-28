import { describe, expect, it } from "vitest";

import { linkReplaceWarningKey } from "./recipes-client";
import { staffUiCopy } from "@/lib/staff/locale";

const withLink = (kind: "recipe" | "direct_stock" | null) => ({ link: kind ? { kind } : null });

describe("replace link warning", () => {
  it("warns in English and Arabic that the recipe link ends when a replace switches it to direct stock", () => {
    const key = linkReplaceWarningKey({ replace: true, variant: withLink("recipe") }, "direct_stock");
    expect(key).toBe("linkReplaceEndsRecipe");
    expect(staffUiCopy("en", key!)).toBe(
      "The current recipe link ends on the start date. After that this variant uses the stock item instead.",
    );
    expect(staffUiCopy("ar", key!)).toBe(
      "ينتهي ربط الوصفة الحالي في تاريخ البدء. بعد ذلك يستخدم هذا المتغيّر صنف المخزون بدلًا منها.",
    );
  });

  it("warns that the direct-stock link ends when a replace switches it to a recipe", () => {
    const key = linkReplaceWarningKey({ replace: true, variant: withLink("direct_stock") }, "recipe");
    expect(key).toBe("linkReplaceEndsStock");
    expect(staffUiCopy("en", key!)).toContain("direct-stock link ends");
    expect(staffUiCopy("ar", key!)).toContain("المخزون المباشر");
  });

  it("says nothing on a first-time link or when the replace keeps the same link type", () => {
    expect(linkReplaceWarningKey({ replace: false, variant: withLink(null) }, "recipe")).toBeNull();
    expect(linkReplaceWarningKey({ replace: false, variant: withLink(null) }, "direct_stock")).toBeNull();
    expect(linkReplaceWarningKey({ replace: true, variant: withLink("recipe") }, "recipe")).toBeNull();
    expect(linkReplaceWarningKey({ replace: true, variant: withLink("direct_stock") }, "direct_stock")).toBeNull();
  });
});
