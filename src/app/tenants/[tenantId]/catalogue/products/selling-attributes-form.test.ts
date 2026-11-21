import { describe, expect, it } from "vitest";

import {
  booleanFromTriState,
  optionalNumberText,
  parseOptionalPositiveNumber,
  parseOptionalWholeNumber,
  triStateFromBoolean,
} from "@/app/tenants/[tenantId]/catalogue/products/selling-attributes-form";

describe("selling attribute form helpers", () => {
  it("round-trips unknown, yes and no without collapsing unknown into no", () => {
    expect([true, false, null].map(triStateFromBoolean)).toEqual(["yes", "no", "unknown"]);
    expect((["yes", "no", "unknown"] as const).map(booleanFromTriState)).toEqual([true, false, null]);
  });

  it("keeps blank as unknown and 0 as a value", () => {
    expect(parseOptionalWholeNumber("")).toBeNull();
    expect(parseOptionalWholeNumber("  ")).toBeNull();
    expect(parseOptionalWholeNumber("0")).toBe(0);
    expect(parseOptionalWholeNumber("12")).toBe(12);
    expect(parseOptionalWholeNumber("-1")).toBe("invalid");
    expect(parseOptionalWholeNumber("2.5")).toBe("invalid");
    expect(optionalNumberText(null)).toBe("");
    expect(optionalNumberText(0)).toBe("0");
  });

  it("accepts only positive price unit quantities", () => {
    expect(parseOptionalPositiveNumber("")).toBeNull();
    expect(parseOptionalPositiveNumber("100")).toBe(100);
    expect(parseOptionalPositiveNumber("0.5")).toBe(0.5);
    expect(parseOptionalPositiveNumber("0")).toBe("invalid");
    expect(parseOptionalPositiveNumber("abc")).toBe("invalid");
  });
});
