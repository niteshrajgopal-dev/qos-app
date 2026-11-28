import { describe, expect, it } from "vitest";

import { STAFF_UI_COPY } from "@/lib/staff/locale";
import type { RowApplyOutcome } from "@/lib/workbook/apply/model";
import {
  applyEditorHref,
  describeAppliedRecord,
  describeApplyFailure,
  describeDependencies,
  describeReviewDiagnostic,
  describeReviewOwner,
  indexReviewRows,
  PHASE2_REASON_COPY,
  pendingSheets,
  REVIEW_OWNER_COPY,
  sheetLabel,
} from "@/lib/workbook/review-view";
import {
  COMBOS_OWNER,
  EXTERNAL_MAPPINGS_OWNER,
  OPENING_STOCK_OWNER,
  PREP_TARGETS_OWNER,
  sheetOwner,
} from "@/lib/workbook/validation/actions";
import { deferredOwner, MECHANICS_OWNER, VALIDATED_OWNER } from "@/lib/workbook/validation/capability";
import type { ReviewRow } from "@/lib/workbook/validation/model";

/* QOS-200 wording of the Phase 2 import: every owner, reason and saved
   record has English and Arabic copy, no ticket id reaches the screen, and
   the kept sheets are listed with their disposition. */

const ARABIC = /[؀-ۿ]/;
const TICKET = /QOS-\d/;

function savedRow(sheet: string, outcome: Partial<RowApplyOutcome>): ReviewRow {
  return {
    sheet,
    row: 7,
    key: "k",
    requestedAction: "create",
    classification: "create",
    operation: "create",
    identity: { namespace: "qos:t", keyVerified: true, targetPublicId: null, targetRevision: null, via: null },
    label: { en: "", ar: "" },
    before: null,
    after: {},
    changes: [],
    deferredFields: [],
    diagnostics: [],
    dependencies: { blockedBy: [], blocks: [] },
    decision: null,
    apply: { state: "applied", appliedPublicId: null, appliedAt: null, applyPublicId: null, error: null, result: null, ...outcome },
  } as ReviewRow;
}

describe("Phase 2 import wording", () => {
  it("words every owner the server sends for the Phase 2 and kept sheets, without ticket ids", () => {
    const owners = [
      VALIDATED_OWNER,
      MECHANICS_OWNER,
      PREP_TARGETS_OWNER,
      EXTERNAL_MAPPINGS_OWNER,
      OPENING_STOCK_OWNER,
      COMBOS_OWNER,
      sheetOwner("Prep Targets"),
      deferredOwner("Recipes", "effective_from"),
      deferredOwner("Recipes", "version_number"),
      deferredOwner("Recipe Lines", "notes"),
      deferredOwner("Prep Steps", "title"),
      deferredOwner("Variants", "price_tax_basis"),
      deferredOwner("Product Modifiers", "min_selections"),
    ];
    for (const owner of owners) {
      const key = REVIEW_OWNER_COPY[owner];
      expect(key, owner).toBeDefined();
      expect(owner, owner).not.toMatch(TICKET);
      expect(describeReviewOwner("en", owner)).toBe(owner);
      expect(describeReviewOwner("ar", owner), owner).toMatch(ARABIC);
      expect(describeReviewOwner("ar", owner), owner).not.toMatch(/[A-Za-z]{3,}/);
    }
    for (const [key, value] of Object.entries(STAFF_UI_COPY.en)) {
      if (key.startsWith("reviewOwner") || key.startsWith("reviewReason") || key.startsWith("applyRecord") || key.startsWith("reviewPending")) {
        expect(value, key).not.toMatch(TICKET);
        expect(STAFF_UI_COPY.ar[key as keyof typeof STAFF_UI_COPY.ar], key).not.toMatch(TICKET);
      }
    }
  });

  it("explains service refusals with the rule's own reason in both languages", () => {
    for (const [reason, key] of Object.entries(PHASE2_REASON_COPY)) {
      for (const locale of ["en", "ar"] as const) {
        const diagnostic = describeReviewDiagnostic(locale, { severity: "error", code: "service_validation", column: "c", params: { field: "c", reason, message: "m" } });
        expect(diagnostic, `${locale}:${reason}`).toContain(STAFF_UI_COPY[locale][key].slice(1));
        expect(diagnostic).not.toMatch(/\{\w+\}/);
        const failure = describeApplyFailure(locale, { code: "service_validation", reason });
        expect(failure, `${locale}:${reason}`).toContain(STAFF_UI_COPY[locale][key].slice(1));
      }
    }
    const conflict = describeReviewDiagnostic("ar", { severity: "error", code: "existing_record_conflict", params: { reason: "draft_exists", candidates: 1 } });
    expect(conflict).toContain(STAFF_UI_COPY.ar.reviewReasonDraftExists);
    expect(conflict).not.toMatch(/draft_exists/);
    expect(describeReviewDiagnostic("en", { severity: "error", code: "malformed_date", column: "cost_effective_date", params: { value: "28/11/2026" } })).toBe(
      "28/11/2026 in cost_effective_date is not a date. Use a date like 2026-11-28.",
    );
  });

  it("lists only the kept and rejected sheets that carried rows, named in the operator's language", () => {
    const pending = pendingSheets([
      { sheet: "Units", support: "supported", rowCount: 4 },
      { sheet: "Prep Targets", support: "deferred", rowCount: 2 },
      { sheet: "Opening Stock", support: "deferred", rowCount: 0 },
      { sheet: "External Mappings", support: "deferred", rowCount: 1 },
      { sheet: "Future Combos", support: "rejected", rowCount: 1 },
    ]);
    expect(pending).toEqual([
      { sheet: "Prep Targets", rejected: false, rowCount: 2, owner: "reviewOwnerPrepTargetsPending" },
      { sheet: "External Mappings", rejected: false, rowCount: 1, owner: "reviewOwnerExternalMappingsPending" },
      { sheet: "Future Combos", rejected: true, rowCount: 1, owner: "reviewOwnerPhase3Combos" },
    ]);
    for (const entry of pending) expect(sheetLabel("ar", entry.sheet)).toMatch(ARABIC);
  });

  it("describes saved sub-records and blocking dependencies", () => {
    expect(describeAppliedRecord("en", { kind: "recipe_version", publicId: "recv_1", revision: 2, created: true })).toBe("Draft version 2");
    expect(describeAppliedRecord("en", { kind: "conversion", publicId: "standard", note: "standard", created: false })).toBe("Standard conversion, nothing stored");
    expect(describeAppliedRecord("en", { kind: "reference_cost", publicId: "cost_1", revision: 3, created: true, effectiveFrom: "2026-11-15" })).toContain("revision 3");
    expect(describeAppliedRecord("ar", { kind: "reference_cost", publicId: "cost_1", note: "closed", created: false })).toBe(STAFF_UI_COPY.ar.applyRecordCostClosed);
    expect(describeDependencies("en", [{ kind: "inventory_items", count: 2 }, { kind: "recipe_lines", count: 1 }])).toBe("Used by 2 active items, Used on 1 recipe line");
    expect(describeDependencies("ar", [{ kind: "inventory_items", count: 3 }])).toMatch(ARABIC);
  });

  it("opens each saved Phase 2 record in its existing editor", () => {
    const tenant = "ten_1";
    const href = (sheet: string, outcome: Partial<RowApplyOutcome>) => applyEditorHref(tenant, savedRow(sheet, outcome), indexReviewRows([]));
    expect(href("Units", { appliedPublicId: "unit_box_1" })).toBe("/tenants/ten_1/inventory/units/unit_box_1/edit");
    expect(href("Suppliers", { appliedPublicId: "sup_1" })).toBe("/tenants/ten_1/inventory/suppliers/sup_1");
    expect(href("Warehouses", { appliedPublicId: "wh_1" })).toBe("/tenants/ten_1/inventory/warehouses/wh_1");
    expect(href("Inventory Categories", { appliedPublicId: "invcat_1" })).toBe("/tenants/ten_1/inventory/categories/invcat_1");
    expect(href("Ingredients", { appliedPublicId: "item_1" })).toBe("/tenants/ten_1/inventory/items/item_1");
    const result = { operation: "create" as const, fieldsApplied: [], deferred: [], parentPublicId: "rec_1", versionPublicId: "recv_2" };
    expect(href("Recipes", { appliedPublicId: "recv_2", result })).toBe("/tenants/ten_1/catalogue/recipes/rec_1/versions/recv_2");
    expect(href("Recipe Lines", { appliedPublicId: "recl_1", result })).toBe("/tenants/ten_1/catalogue/recipes/rec_1/versions/recv_2");
    expect(href("Modifier Effects", { appliedPublicId: "eff_1", state: "failed" })).toBeNull();
  });
});
