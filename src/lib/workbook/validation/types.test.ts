import { describe, expect, it } from "vitest";

import { contractSheet } from "@/lib/workbook/contract";
import {
  isClearable,
  parseBoolean,
  parseClearFields,
  parseDecimalSyntax,
  parseEnum,
  parseInteger,
  parseMinorUnits,
  parseRevision,
  parseUrl,
} from "@/lib/workbook/validation/types";

describe("strict cell types", () => {
  it("accepts whole minor units only and never truncates", () => {
    expect(parseMinorUnits("0", "amount_minor")).toEqual({ ok: true, value: 0 });
    expect(parseMinorUnits("1250", "amount_minor")).toEqual({ ok: true, value: 1250 });
    for (const text of ["12.50", "1,250", "1250.0", "1e3", "+5", "-5", "١٢٥٠", "12 50", "01250", "abc", ""]) {
      const parsed = parseMinorUnits(text, "amount_minor");
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) {
        expect(parsed.diagnostic).toMatchObject({ severity: "error", code: "malformed_minor_units", column: "amount_minor", params: { value: text } });
      }
    }
  });

  it("checks integers and their bounds", () => {
    expect(parseInteger("3", "sort_order", { min: 0 })).toEqual({ ok: true, value: 3 });
    expect(parseInteger("-1", "sort_order", { min: 0 })).toMatchObject({ ok: false, diagnostic: { code: "integer_out_of_range" } });
    expect(parseInteger("10001", "tax", { min: 0, max: 10_000 })).toMatchObject({ ok: false, diagnostic: { code: "integer_out_of_range" } });
    for (const text of ["1.5", "1,000", "2e2", " ", "07"]) {
      expect(parseInteger(text, "sort_order").ok, text).toBe(false);
    }
  });

  it("reads booleans and enums strictly, normalising case with a note", () => {
    expect(parseBoolean("TRUE", "is_default")).toEqual({ ok: true, value: true });
    expect(parseBoolean("false", "is_default")).toMatchObject({ ok: true, value: false, notes: [{ code: "value_normalized", params: { value: "false", normalized: "FALSE" } }] });
    expect(parseBoolean("yes", "is_default")).toMatchObject({ ok: false, diagnostic: { code: "value_not_allowed", params: { allowed: "TRUE, FALSE" } } });
    expect(parseBoolean("0", "is_default").ok).toBe(false);
    expect(parseEnum("Active", "status", ["draft", "active", "archived"])).toMatchObject({ ok: true, value: "active" });
    expect(parseEnum("live", "status", ["draft", "active", "archived"]).ok).toBe(false);
  });

  it("accepts only public https image addresses", () => {
    expect(parseUrl("https://images.example.test/a.jpg", "image_url")).toEqual({ ok: true, value: "https://images.example.test/a.jpg" });
    expect(parseUrl("http://images.example.test/a.jpg", "image_url")).toMatchObject({ ok: false, diagnostic: { code: "invalid_url" } });
    expect(parseUrl("https://localhost/a.jpg", "image_url")).toMatchObject({ ok: false, diagnostic: { code: "invalid_url" } });
    expect(parseUrl("not a url", "image_url").ok).toBe(false);
  });

  it("checks revision tokens and decimal syntax on deferred sheets as warnings", () => {
    expect(parseRevision("", "expected_revision")).toEqual({ ok: true, value: null });
    expect(parseRevision("rv1.abcdefghijklmnopqrstuv", "expected_revision")).toMatchObject({ ok: true });
    expect(parseRevision("rv2.x", "expected_revision")).toMatchObject({ ok: false, diagnostic: { code: "malformed_revision" } });
    expect(parseDecimalSyntax("0.015", "quantity_per_sold_unit", { positive: true })).toEqual({ ok: true, value: "0.015" });
    expect(parseDecimalSyntax("1.2.3", "quantity")).toMatchObject({ ok: false, diagnostic: { severity: "warning", code: "invalid_number" } });
    expect(parseDecimalSyntax("-1", "quantity", { positive: true })).toMatchObject({ ok: false, diagnostic: { severity: "warning", code: "negative_amount" } });
  });

  it("parses clear_fields: only optional data columns, never with a value, never on create", () => {
    const products = contractSheet("Products");
    expect(parseClearFields("description_en, barcode", products, { description_en: "", barcode: "" }, "update")).toEqual({ columns: ["description_en", "barcode"], diagnostics: [] });
    const result = parseClearFields("nope, display_name_en, qos_product_id, description_ar, action", products, { description_ar: "Kept" }, "update");
    expect(result.columns).toEqual([]);
    expect(result.diagnostics.map((entry) => [entry.code, entry.params?.field])).toEqual([
      ["clear_field_unknown", "nope"],
      ["clear_field_not_clearable", "display_name_en"],
      ["clear_field_not_clearable", "qos_product_id"],
      ["clear_field_conflicts_with_value", "description_ar"],
      ["clear_field_not_clearable", "action"],
    ]);
    expect(parseClearFields("description_en", products, {}, "create").diagnostics).toEqual([
      expect.objectContaining({ code: "clear_fields_on_create" }),
    ]);
    expect(isClearable(products.columns.find((column) => column.key === "product_key")!)).toBe(false);
  });
});
