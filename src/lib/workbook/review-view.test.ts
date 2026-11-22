import { describe, expect, it } from "vitest";

import { STAFF_UI_COPY } from "@/lib/staff/locale";
import { APPLY_FAILURE_CODES, ROW_APPLY_STATES, type RowApplyOutcome } from "@/lib/workbook/apply/model";
import {
  APPLY_API_ERROR_CODES,
  APPLY_ATTEMPT_STATUS_COPY,
  APPLY_BLOCK_REASON_COPY,
  APPLY_ERROR_COPY,
  APPLY_FAILURE_COPY,
  APPLY_FAILURE_REASON_COPY,
  APPLY_IMAGE_COPY,
  APPLY_ROW_STATE_COPY,
  applyEditorHref,
  describeApplyApiError,
  describeApplyFailure,
  indexReviewRows,
  PLAN_STATUS_COPY,
  summariseApplyBySheet,
  describeReviewApiError,
  describeReviewDiagnostic,
  diagnosticLocation,
  filterReviewRows,
  formatMinorUnits,
  formatReviewValue,
  REVIEW_BLOCKER_COPY,
  REVIEW_CLASSIFICATION_COPY,
  REVIEW_CLASSIFICATION_SUB_COPY,
  REVIEW_DECISION_COPY,
  REVIEW_DIAGNOSTIC_COPY,
  REVIEW_ERROR_COPY,
  REVIEW_FIELD_DECISION_COPY,
  REVIEW_FILTER_COPY,
  REVIEW_OPERATION_COPY,
  rowLocation,
} from "@/lib/workbook/review-view";
import { REVIEW_CLASSIFICATIONS, REVIEW_DIAGNOSTIC_CODES, REVIEW_OPERATIONS, type ReviewRow } from "@/lib/workbook/validation/model";

const ALL_KEYS = [
  ...Object.values(REVIEW_CLASSIFICATION_COPY),
  ...Object.values(REVIEW_CLASSIFICATION_SUB_COPY),
  ...Object.values(REVIEW_OPERATION_COPY),
  ...Object.values(REVIEW_DIAGNOSTIC_COPY),
  ...Object.values(REVIEW_DECISION_COPY),
  ...Object.values(REVIEW_FIELD_DECISION_COPY),
  ...Object.values(REVIEW_BLOCKER_COPY),
  ...Object.values(REVIEW_ERROR_COPY),
  ...Object.values(REVIEW_FILTER_COPY),
];

function row(partial: Partial<ReviewRow>): ReviewRow {
  return {
    sheet: "Variants",
    row: 12,
    key: "v1",
    requestedAction: "update",
    classification: "update",
    operation: "update",
    identity: { namespace: "qos:t", keyVerified: true, targetPublicId: null, targetRevision: null, via: null },
    label: { en: "", ar: "" },
    before: null,
    after: null,
    changes: [],
    deferredFields: [],
    diagnostics: [],
    dependencies: { blockedBy: [], blocks: [] },
    decision: null,
    ...partial,
  };
}

describe("workbook review wording", () => {
  it("covers every classification, operation, diagnostic, decision and field decision in English and Arabic", () => {
    expect(Object.keys(REVIEW_CLASSIFICATION_COPY).sort()).toEqual([...REVIEW_CLASSIFICATIONS].sort());
    expect(Object.keys(REVIEW_OPERATION_COPY).sort()).toEqual([...REVIEW_OPERATIONS].sort());
    expect(Object.keys(REVIEW_DIAGNOSTIC_COPY).sort()).toEqual([...REVIEW_DIAGNOSTIC_CODES].sort());
    for (const key of ALL_KEYS) {
      expect(STAFF_UI_COPY.en[key], key).toBeTruthy();
      expect(STAFF_UI_COPY.ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("keeps the same placeholders in English and Arabic and never shouts", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(STAFF_UI_COPY.en) as Array<keyof typeof STAFF_UI_COPY.en>) {
      if (!key.startsWith("review")) continue;
      expect(placeholders(STAFF_UI_COPY.ar[key]), key).toEqual(placeholders(STAFF_UI_COPY.en[key]));
      for (const locale of ["en", "ar"] as const) {
        const words = STAFF_UI_COPY[locale][key].replace(/\{\w+\}/g, "").match(/\b[A-Z]{4,}\b/g) ?? [];
        expect(words.filter((word) => !["XLSX", "QOS"].includes(word)), key).toEqual([]);
        expect(STAFF_UI_COPY[locale][key], key).not.toMatch(/\b(imported|persisted)\b/i);
      }
    }
  });

  it("fills diagnostic parameters in both languages, including reader issues carried onto rows", () => {
    const minor = { severity: "error" as const, code: "malformed_minor_units" as const, column: "amount_minor", params: { value: "12.50" } };
    expect(describeReviewDiagnostic("en", minor)).toBe("12.50 in amount_minor is not whole minor units. Type whole numbers only, for example 1250 for 12.50.");
    expect(describeReviewDiagnostic("ar", minor)).toContain("12.50");
    expect(describeReviewDiagnostic("ar", minor)).not.toMatch(/\{\w+\}/);
    const blocked = describeReviewDiagnostic("en", { severity: "error", code: "blocked_by_dependency", params: { refSheet: "Products", row: 7, key: "p1", reason: "conflicting" } });
    expect(blocked).toBe("Waits for Products row 7 (p1), which is Conflicting.");
    const reader = describeReviewDiagnostic("en", { severity: "error", code: "formula_ignored", column: "internal_name", params: { cell: "D7" } });
    expect(reader).toBe("Formula in internal_name. QOS never calculates formulas; type the value instead.");
    for (const code of REVIEW_DIAGNOSTIC_CODES) {
      for (const locale of ["en", "ar"] as const) {
        const text = describeReviewDiagnostic(locale, {
          severity: "error",
          code,
          column: "c",
          params: { value: "v", allowed: "a", normalized: "n", field: "f", id: "i", candidates: 2, row: 1, key: "k", rows: "1", expected: "e", current: "c", revision: "r", refSheet: "S", reason: "invalid", branch: "b", count: 2, max: 1, product: "p", owner: "o", kind: "exclude", exported: "x", found: "f" },
        });
        expect(text, `${locale}:${code}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("formats minor units as money and leaves other values verbatim", () => {
    expect(formatMinorUnits("en", "AED", "1250")).toMatch(/12\.50/);
    expect(formatMinorUnits("ar", "AED", "1250")).toMatch(/12\.50/);
    expect(formatMinorUnits("en", "AED", "5")).toMatch(/0\.05/);
    expect(formatMinorUnits("en", "AED", "12.50")).toBe("12.50");
    expect(formatReviewValue("en", "AED", "sku", "000123")).toBe("000123");
    expect(formatReviewValue("en", "AED", "amount_minor", null)).toBeNull();
  });

  it("names Excel locations and filters rows needing a decision first", () => {
    expect(rowLocation(row({}))).toBe("Variants!12:12");
    const converted = row({ source: { sheet: "Products", row: 11, range: "Products!D11:V11", cells: { amount_minor: "Products!K11" }, values: {} } });
    expect(rowLocation(converted)).toBe("Products!D11:V11");
    expect(diagnosticLocation(converted, { severity: "error", code: "malformed_minor_units", cell: "Products!K11" })).toBe("Products!K11");
    const rows = [row({ classification: "conflicting" }), row({ classification: "create", sheet: "Products" }), row({ classification: "invalid" })];
    expect(filterReviewRows(rows, "needs_decision", "").map((entry) => entry.classification)).toEqual(["conflicting"]);
    expect(filterReviewRows(rows, "all", "Products")).toHaveLength(1);
  });

  it("explains review API failures from their code", () => {
    expect(describeReviewApiError("en", 409, { code: "review_context_rejected", found: "ten_flowers_dev" })).toContain("ten_flowers_dev");
    expect(describeReviewApiError("ar", 403, { code: "plan_not_yours" })).toMatch(/[؀-ۿ]/);
    expect(describeReviewApiError("en", 400, { code: "brand_required" })).toBe(STAFF_UI_COPY.en.importBrandRequired);
    expect(describeReviewApiError("en", 401, null)).toBe(STAFF_UI_COPY.en.workbookErrorSignedOut);
  });
});

const APPLY_KEYS = [
  ...Object.values(APPLY_ROW_STATE_COPY),
  ...Object.values(APPLY_FAILURE_COPY),
  ...Object.values(APPLY_FAILURE_REASON_COPY),
  ...Object.values(APPLY_BLOCK_REASON_COPY),
  ...Object.values(APPLY_ATTEMPT_STATUS_COPY),
  ...Object.values(APPLY_IMAGE_COPY),
  ...Object.values(APPLY_ERROR_COPY),
  ...Object.values(PLAN_STATUS_COPY),
];

/** Words of two or more letters written fully in capitals, except acronyms the staff copy already uses. */
function shouting(text: string) {
  const words = text.replace(/\{\w+\}/g, "").match(/\b[A-Z]{2,}\b/g) ?? [];
  return words.filter((word) => !["QOS", "AED", "SKU", "XLSX"].includes(word));
}

function outcome(partial: Partial<RowApplyOutcome>): RowApplyOutcome {
  return { state: "applied", appliedPublicId: null, appliedAt: null, applyPublicId: "wba_1", error: null, result: null, ...partial };
}

describe("workbook apply wording", () => {
  it("covers every row state, failure code and block reason with real English and Arabic", () => {
    expect(Object.keys(APPLY_ROW_STATE_COPY).sort()).toEqual([...ROW_APPLY_STATES].sort());
    expect(Object.keys(APPLY_FAILURE_COPY).sort()).toEqual([...APPLY_FAILURE_CODES].sort());
    expect(Object.keys(APPLY_BLOCK_REASON_COPY).sort()).toEqual(
      ["not_administrator", "review_incomplete", "stale", "applying", "applied", "apply_failed"].sort(),
    );
    expect(Object.keys(APPLY_ERROR_COPY).sort()).toEqual([...APPLY_API_ERROR_CODES].sort());
    for (const key of APPLY_KEYS) {
      expect(STAFF_UI_COPY.en[key], key).toBeTruthy();
      expect(STAFF_UI_COPY.ar[key], key).toMatch(/[؀-ۿ]/);
      expect(shouting(STAFF_UI_COPY.en[key]), key).toEqual([]);
      expect(shouting(STAFF_UI_COPY.ar[key]), key).toEqual([]);
    }
  });

  it("keeps apply placeholders in parity and never shouts", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(STAFF_UI_COPY.en) as Array<keyof typeof STAFF_UI_COPY.en>) {
      if (!key.startsWith("apply")) continue;
      expect(placeholders(STAFF_UI_COPY.ar[key]), key).toEqual(placeholders(STAFF_UI_COPY.en[key]));
      for (const locale of ["en", "ar"] as const) {
        expect(STAFF_UI_COPY[locale][key].trim(), key).not.toBe("");
        expect(shouting(STAFF_UI_COPY[locale][key]), key).toEqual([]);
      }
    }
  });

  it("explains failures by code and rule reason, and apply API errors by code", () => {
    expect(describeApplyFailure("en", { code: "conflict" })).toBe(STAFF_UI_COPY.en.applyFailConflict);
    expect(describeApplyFailure("en", { code: "service_validation", reason: "branch_price_default_variant_only" })).toContain(
      STAFF_UI_COPY.en.applyReasonBranchPriceDefaultVariantOnly,
    );
    expect(describeApplyFailure("ar", { code: "unexpected", reason: "menu_requires_branch" })).toContain(STAFF_UI_COPY.ar.applyReasonMenuRequiresBranch);
    expect(describeApplyApiError("en", 403, { code: "apply_requires_administrator" })).toBe(STAFF_UI_COPY.en.applyErrorRequiresAdministrator);
    expect(describeApplyApiError("ar", 409, { code: "plan_stale" })).toBe(STAFF_UI_COPY.ar.applyErrorPlanStale);
    expect(describeReviewApiError("en", 409, { code: "plan_applied" })).toBe(STAFF_UI_COPY.en.applyErrorPlanApplied);
    expect(describeApplyApiError("en", 401, null)).toBe(STAFF_UI_COPY.en.workbookErrorSignedOut);
  });

  it("summarises saved versus parsed per sheet and links saved rows to their editor", () => {
    const deferred = [{ column: "tax_rate_basis_points", value: "500", owner: "QOS-212" }];
    const rows = [
      row({ sheet: "Products", key: "p1", apply: outcome({ appliedPublicId: "prd_latte_1a2b3c4d" }) }),
      row({ sheet: "Variants", key: "v1", after: { product_key: "p1" }, deferredFields: deferred, apply: outcome({ state: "already_applied", appliedPublicId: "var_x" }) }),
      row({ sheet: "Variants", key: "v2", after: { product_key: "p1" }, apply: outcome({ state: "failed", error: { code: "conflict", message: "x" } }) }),
      row({ sheet: "Branch Prices", key: "bp1", after: { variant_key: "v1" }, apply: outcome({ appliedPublicId: "0000-link" }) }),
      row({ sheet: "Menu Items", key: "mi1", after: { section_key: "s1" }, apply: outcome({ appliedPublicId: "mit_1" }) }),
      row({ sheet: "Menu Sections", key: "s1", after: { menu_key: "men_breakfast_12345678" }, apply: outcome({ appliedPublicId: "sec_1" }) }),
      row({ sheet: "Modifier Options", key: "o1", after: { modifier_group_key: "g1" }, apply: outcome({ state: "not_applied" }) }),
      row({ sheet: "Categories", key: "c1", apply: outcome({ appliedPublicId: "cat_hot_12345678" }) }),
    ];
    expect(summariseApplyBySheet(rows).find((entry) => entry.sheet === "Variants")).toEqual({ sheet: "Variants", saved: 1, notApplied: 0, failed: 1, deferredValues: 1 });
    const index = indexReviewRows(rows);
    const tenant = "t1";
    expect(applyEditorHref(tenant, rows[0], index)).toBe("/tenants/t1/catalogue/products/prd_latte_1a2b3c4d/edit");
    expect(applyEditorHref(tenant, rows[1], index)).toBe("/tenants/t1/catalogue/products/prd_latte_1a2b3c4d/edit");
    expect(applyEditorHref(tenant, rows[2], index)).toBeNull();
    expect(applyEditorHref(tenant, rows[3], index)).toBe("/tenants/t1/catalogue/products/prd_latte_1a2b3c4d/edit");
    expect(applyEditorHref(tenant, rows[4], index)).toBe("/tenants/t1/catalogue/menus/men_breakfast_12345678/edit");
    expect(applyEditorHref(tenant, rows[6], index)).toBeNull();
    expect(applyEditorHref(tenant, rows[7], index)).toBe("/tenants/t1/catalogue/categories/cat_hot_12345678/edit");
  });
});
