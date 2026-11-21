import { describe, expect, it } from "vitest";

import { STAFF_UI_COPY } from "@/lib/staff/locale";
import {
  attachmentFileName,
  describeWorkbookApiError,
  describeWorkbookIssue,
  WORKBOOK_CAPABILITY_COPY,
  WORKBOOK_ERROR_COPY,
  WORKBOOK_ISSUE_COPY,
  WORKBOOK_REGION_COPY,
  WORKBOOK_SEVERITY_COPY,
  WORKBOOK_SUPPORT_COPY,
  workbookIssueLocation,
} from "@/lib/workbook/import-view";
import type { WorkbookIssue } from "@/lib/workbook/reader";

const ALL_KEYS = [
  ...Object.values(WORKBOOK_ISSUE_COPY),
  ...Object.values(WORKBOOK_ERROR_COPY),
  ...Object.values(WORKBOOK_SUPPORT_COPY),
  ...Object.values(WORKBOOK_SEVERITY_COPY),
  ...Object.values(WORKBOOK_REGION_COPY),
  ...Object.values(WORKBOOK_CAPABILITY_COPY),
];

describe("workbook import wording", () => {
  it("has English and Arabic copy for every issue, error, support class and severity", () => {
    for (const key of ALL_KEYS) {
      expect(STAFF_UI_COPY.en[key], key).toBeTruthy();
      expect(STAFF_UI_COPY.ar[key], key).toBeTruthy();
      expect(STAFF_UI_COPY.ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("describes an ambiguous selection count mode without suggesting a guessed rule", () => {
    const issue: WorkbookIssue = {
      severity: "error",
      code: "ambiguous_selection_count_mode",
      sheet: "Product Modifiers",
      row: 9,
      column: "selection_count_mode",
      params: { cell: "J9", value: "Total" },
    };
    expect(describeWorkbookIssue("en", issue)).toBe(
      'selection_count_mode is "Total". Use distinct_options, total_quantity or leave it blank. This assignment is held for review; QOS will not guess the counting rule.',
    );
    expect(describeWorkbookIssue("ar", issue)).toContain('"Total"');
    expect(describeWorkbookIssue("ar", issue)).toContain("selection_count_mode");
    expect(workbookIssueLocation(issue)).toBe("Product Modifiers!J9");
  });

  it("keeps the same placeholders in English and Arabic", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(STAFF_UI_COPY.en) as Array<keyof typeof STAFF_UI_COPY.en>) {
      if (!/^(import|issue|workbookError)/.test(key)) continue;
      expect(placeholders(STAFF_UI_COPY.ar[key]), key).toEqual(placeholders(STAFF_UI_COPY.en[key]));
    }
  });

  it("uses no upper-case shouting in the new copy", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const [key, text] of Object.entries(STAFF_UI_COPY[locale])) {
        if (!/^(import|issue|workbookError)/.test(key)) continue;
        const words = text.replace(/\{\w+\}/g, "").match(/\b[A-Z]{4,}\b/g) ?? [];
        expect(words.filter((word) => !["XLSX", "UTF", "QOS"].includes(word)), key).toEqual([]);
      }
    }
  });

  it("fills issue parameters and names the Excel location", () => {
    const issue: WorkbookIssue = {
      severity: "error",
      code: "formula_ignored",
      sheet: "Products",
      row: 7,
      column: "internal_name",
      params: { cell: "D7" },
    };
    expect(describeWorkbookIssue("en", issue)).toBe(
      "Formula in internal_name. QOS never calculates formulas; type the value instead.",
    );
    expect(describeWorkbookIssue("ar", issue)).toBe("توجد صيغة في العمود internal_name. لا يحسب QOS الصيغ أبدًا، فاكتب القيمة مباشرةً.");
    expect(workbookIssueLocation(issue)).toBe("Products!D7");
    expect(workbookIssueLocation({ severity: "warning", code: "identifier_number", sheet: "Variants", row: 9 })).toBe("Variants!9:9");

    const deferred = describeWorkbookIssue("ar", {
      severity: "warning",
      code: "deferred_sheet",
      sheet: "Units",
      params: { count: 3 },
    });
    expect(deferred).toContain("3");
    expect(deferred).not.toMatch(/\{\w+\}/);
  });

  it("explains API failures from their code, or from the status when there is none", () => {
    expect(describeWorkbookApiError("en", 413, { code: "file_too_large", params: { maxBytes: 8 * 1024 * 1024 } })).toBe(
      "The file is larger than 8 MB.",
    );
    expect(describeWorkbookApiError("ar", 400, { code: "unsupported_version", params: { version: "2.0", expected: "1.0" } })).toBe(
      "إصدار النموذج 2.0 غير مدعوم. نزّل النموذج الحالي.",
    );
    expect(describeWorkbookApiError("en", 422, { code: "export_too_large", sheet: "Products", max: 1000 })).toBe(
      "Products has more records than one workbook can carry (1000).",
    );
    expect(describeWorkbookApiError("en", 403, { code: "tenant_inactive" })).toBe(
      "You do not have access to this action for the selected branch.",
    );
    expect(describeWorkbookApiError("ar", 404, null)).toBe("لم يُعثر على هذا النشاط.");
    expect(describeWorkbookApiError("en", 401, null)).toBe("Your session has ended. Sign in again.");
    expect(describeWorkbookApiError("en", 500, { code: "nope" })).toBe("Something went wrong. Try again.");
  });

  it("describes Foodics menu source issues at their source cell, in English and Arabic", () => {
    const issue: WorkbookIssue = {
      severity: "error",
      code: "unresolved_reference",
      sheet: "Products",
      row: 12,
      column: "Category",
      params: { cell: "H12", field: "category", value: "Cold drinks" },
    };
    expect(describeWorkbookIssue("en", issue)).toBe(
      "Cold drinks in Category does not match any name in this file. The link was not created.",
    );
    expect(describeWorkbookIssue("ar", issue)).toBe("القيمة Cold drinks في العمود Category لا تطابق أي اسم في هذا الملف. لم يُنشأ الربط.");
    expect(workbookIssueLocation(issue)).toBe("Products!H12");
    expect(
      describeWorkbookIssue("en", { severity: "info", code: "example_rows_skipped", sheet: "Products", params: { region: "products", range: "D7:V10", populated: 4 } }),
    ).toBe("Example rows D7:V10 were skipped by position and never read. Rows with typed text there: 4.");
  });

  it("explains a modified Foodics layout and refused conversions", () => {
    expect(
      describeWorkbookApiError("en", 400, {
        code: "source_layout_partial",
        params: { region: "products", sheet: "Products", expectedRef: "D6:V6", foundRow: 7 },
      }),
    ).toBe(
      "This looks like the Foodics menu workbook, but its products table is missing, moved or changed (expected at D6:V6, sheet Products). QOS did not guess; restore the original layout.",
    );
    expect(describeWorkbookApiError("ar", 400, { code: "convert_unsupported_profile", params: { profile: "legacy_flat" } })).toMatch(/Foodics/);
    expect(describeWorkbookApiError("en", 422, { code: "convert_too_large", params: { sheet: "Products", max: 1000 } })).toBe(
      "Products would have more rows than one QOS workbook can carry (1000).",
    );
  });

  it("reads the download file name from Content-Disposition", () => {
    expect(attachmentFileName('attachment; filename="qos-export-ten-brd-20261121T1200Z.xlsx"', "x.xlsx")).toBe(
      "qos-export-ten-brd-20261121T1200Z.xlsx",
    );
    expect(attachmentFileName(null, "fallback.xlsx")).toBe("fallback.xlsx");
  });
});
