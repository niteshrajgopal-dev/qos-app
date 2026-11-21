import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isApplicable, isSaved, planUnits } from "@/lib/workbook/apply/engine";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";
import type { ReviewRowDetail } from "@/lib/workbook/validation/model";

const DETAIL: ReviewRowDetail = {
  identity: { namespace: "ns", keyVerified: false, targetPublicId: null, targetRevision: null, via: null },
  label: { en: "x", ar: "x" },
  candidates: [],
};

function row(overrides: Partial<PlanRowRecord> & Pick<PlanRowRecord, "sheet" | "rowNumber" | "entityKey">): PlanRowRecord {
  return {
    id: overrides.id ?? randomUUID(),
    tenantId: "00000000-0000-4000-8000-000000000001",
    planId: "00000000-0000-4000-8000-000000000002",
    requestedAction: overrides.operation ?? "create",
    classification: "create",
    operation: "create",
    targetPublicId: null,
    targetRevision: null,
    values: {},
    before: null,
    after: {},
    changes: [],
    deferredFields: [],
    diagnostics: [],
    dependencies: { blockedBy: [], blocks: [] },
    detail: DETAIL,
    provenance: null,
    decision: null,
    applyState: null,
    appliedPublicId: null,
    appliedAt: null,
    applyId: null,
    applyError: null,
    applyResult: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("planUnits", () => {
  it("orders units by the contract sheet order, then row number", () => {
    const units = planUnits([
      row({ sheet: "Menu Items", rowNumber: 8, entityKey: "i1" }),
      row({ sheet: "Categories", rowNumber: 9, entityKey: "c2" }),
      row({ sheet: "Categories", rowNumber: 7, entityKey: "c1" }),
      row({ sheet: "Products", rowNumber: 7, entityKey: "p1" }),
    ]);
    expect(units.map((unit) => `${unit.sheet}:${unit.rows[0]!.entityKey}`)).toEqual([
      "Categories:c1",
      "Categories:c2",
      "Products:p1",
      "Menu Items:i1",
    ]);
  });

  it("groups a product create with its default Variants row", () => {
    const product = row({ sheet: "Products", rowNumber: 7, entityKey: "prd~latte" });
    const def = row({
      sheet: "Variants",
      rowNumber: 7,
      entityKey: "prd~latte~regular",
      after: { is_default: "TRUE", product_key: "prd~latte" },
    });
    const other = row({
      sheet: "Variants",
      rowNumber: 8,
      entityKey: "prd~latte~large",
      after: { is_default: "FALSE", product_key: "prd~latte" },
    });
    const units = planUnits([def, other, product]);
    const productUnit = units.find((unit) => unit.sheet === "Products")!;
    expect(productUnit.rows.map((entry) => entry.entityKey)).toEqual(["prd~latte", "prd~latte~regular"]);
    expect(units.filter((unit) => unit.sheet === "Variants")).toHaveLength(1);
    expect(units.find((unit) => unit.sheet === "Variants")!.rows[0]!.entityKey).toBe("prd~latte~large");
  });

  it("groups a menu create with its Menu Branches creates", () => {
    const menu = row({ sheet: "Menus", rowNumber: 7, entityKey: "menu~main" });
    const branch = row({
      sheet: "Menu Branches",
      rowNumber: 7,
      entityKey: "menu~main~loc_a",
      after: { menu_key: "menu~main", branch_key: "loc_a" },
    });
    const units = planUnits([branch, menu]);
    expect(units).toHaveLength(1);
    expect(units[0]!.sheet).toBe("Menus");
    expect(units[0]!.rows.map((entry) => entry.entityKey)).toEqual(["menu~main", "menu~main~loc_a"]);
  });

  it("leaves unchanged, conflicting, invalid, blocked, skipped and unsupported rows out, and skips already applied rows only at execution", () => {
    const create = row({ sheet: "Categories", rowNumber: 7, entityKey: "c1" });
    const ignored = [
      row({ sheet: "Categories", rowNumber: 8, entityKey: "c2", classification: "unchanged", operation: "update" }),
      row({ sheet: "Categories", rowNumber: 9, entityKey: "c3", classification: "conflicting", operation: null }),
      row({ sheet: "Categories", rowNumber: 10, entityKey: "c4", classification: "invalid", operation: null }),
      row({ sheet: "Categories", rowNumber: 11, entityKey: "c5", classification: "blocked", operation: null }),
      row({ sheet: "Categories", rowNumber: 12, entityKey: "c6", classification: "skipped", operation: null }),
      row({ sheet: "Units", rowNumber: 7, entityKey: "u1", classification: "unsupported", operation: null }),
    ];
    const units = planUnits([create, ...ignored]);
    expect(units).toHaveLength(1);
    expect(units[0]!.rows[0]!.entityKey).toBe("c1");
    expect(isApplicable(create)).toBe(true);
    expect(ignored.every((entry) => !isApplicable(entry))).toBe(true);
  });

  it("does not use a display name as identity when planning units", () => {
    const existingName = row({
      sheet: "Categories",
      rowNumber: 7,
      entityKey: "Hot drinks",
      classification: "conflicting",
      operation: null,
      after: { display_name_en: "Hot drinks" },
    });
    expect(planUnits([existingName])).toEqual([]);
  });

  it("treats applied and already_applied rows as saved", () => {
    expect(isSaved(row({ sheet: "Categories", rowNumber: 7, entityKey: "c", applyState: "applied" }))).toBe(true);
    expect(isSaved(row({ sheet: "Categories", rowNumber: 8, entityKey: "d", applyState: "already_applied" }))).toBe(true);
    expect(isSaved(row({ sheet: "Categories", rowNumber: 9, entityKey: "e", applyState: "failed" }))).toBe(false);
    expect(isSaved(row({ sheet: "Categories", rowNumber: 10, entityKey: "f" }))).toBe(false);
  });
});
