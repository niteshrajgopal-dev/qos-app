import { describe, expect, it } from "vitest";

import { InventoryError } from "@/lib/inventory/errors";
import { parseEmail, parseOptionalCode, parseOptionalText, parsePhone, parseRecordCode } from "@/lib/inventory/shared";
import { parseSupplierFields } from "@/lib/inventory/suppliers";

function rejection(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InventoryError);
    const typed = error as InventoryError;
    return { statusCode: typed.statusCode, code: typed.code, field: typed.field };
  }
  throw new Error("expected a rejection");
}

describe("supplier and warehouse field parsers", () => {
  it("accepts phone numbers made of digits, spaces, plus, brackets and hyphens", () => {
    expect(parsePhone("+971 4 123-4567")).toBe("+971 4 123-4567");
    expect(parsePhone(" (04) 555 0101 ")).toBe("(04) 555 0101");
    expect(parsePhone("")).toBeNull();
    expect(parsePhone(null)).toBeNull();
    expect(parsePhone(undefined)).toBeNull();
  });

  it("rejects phone numbers with letters, without digits or longer than 40 characters", () => {
    expect(rejection(() => parsePhone("call 555"))).toEqual({ statusCode: 400, code: "phone_invalid", field: "phone" });
    expect(rejection(() => parsePhone("+ - ()"))).toEqual({ statusCode: 400, code: "phone_invalid", field: "phone" });
    expect(rejection(() => parsePhone("1".repeat(41)))).toEqual({ statusCode: 400, code: "text_too_long", field: "phone" });
  });

  it("accepts a plain email address and rejects malformed ones", () => {
    expect(parseEmail(" orders@gulf-supply.ae ")).toBe("orders@gulf-supply.ae");
    expect(parseEmail("")).toBeNull();
    for (const value of ["orders", "orders@", "orders@gulf", "a b@gulf.ae", "a@@gulf.ae"]) {
      expect(rejection(() => parseEmail(value)), value).toEqual({ statusCode: 400, code: "email_invalid", field: "email" });
    }
    expect(rejection(() => parseEmail(`${"a".repeat(250)}@x.ae`))).toMatchObject({ code: "text_too_long" });
  });

  it("keeps the case of a reference code and enforces the pattern", () => {
    expect(parseOptionalCode(" GS-01 ")).toBe("GS-01");
    expect(parseOptionalCode("")).toBeNull();
    expect(parseOptionalCode(null)).toBeNull();
    expect(parseRecordCode("wh_dubai")).toBe("wh_dubai");
    for (const value of ["-start", "has space", "x".repeat(25), "émile"]) {
      expect(rejection(() => parseOptionalCode(value)), value).toEqual({ statusCode: 400, code: "code_invalid", field: "code" });
    }
    expect(rejection(() => parseRecordCode(""))).toMatchObject({ code: "code_invalid" });
  });

  it("trims optional text, treats blanks as no value and refuses non-text", () => {
    expect(parseOptionalText("  Al Quoz  ", "address", 400)).toBe("Al Quoz");
    expect(parseOptionalText("   ", "address", 400)).toBeNull();
    expect(rejection(() => parseOptionalText("x".repeat(401), "address", 400))).toEqual({
      statusCode: 400,
      code: "text_too_long",
      field: "address",
    });
    expect(rejection(() => parseOptionalText(42, "notes", 10))).toMatchObject({ code: "body_invalid", field: "notes" });
  });

  it("parses only the supplier fields present, so an update leaves the rest unchanged", () => {
    expect(parseSupplierFields({ nameEn: " Gulf Supply ", phone: "", email: null }, true)).toEqual({
      nameEn: "Gulf Supply",
      phone: null,
      email: null,
    });
    expect(parseSupplierFields({ notes: "Deliveries before 9" }, false)).toEqual({ notes: "Deliveries before 9" });
    expect(rejection(() => parseSupplierFields({}, true))).toMatchObject({ code: "name_required", field: "nameEn" });
    expect(rejection(() => parseSupplierFields({ nameEn: "x".repeat(121) }, true))).toMatchObject({ code: "name_too_long" });
  });
});
