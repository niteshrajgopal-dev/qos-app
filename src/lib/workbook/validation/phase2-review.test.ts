import { describe, expect, it } from "vitest";

import { reviewWorkbook, REVIEW_ENGINE_VERSION } from "@/lib/workbook/validation/review";
import { snapshotHashOf } from "@/lib/workbook/validation/snapshot";
import { seedRecords, snapshotFrom, qosInput } from "@/lib/workbook/validation/test-support";
import type { ReviewRow, WorkbookReview } from "@/lib/workbook/validation/model";

/* QOS-200 review rules of the Phase 2 sheets, pure (no database): the active
   flag, standard units (D11), the recipe draft policy (D4) and the
   conflicts the snapshot can prove. */

type Row = Record<string, string>;
const TOKEN = "rv1.aaaaaaaaaaaaaaaaaaaaaa";

const UNIT_KG: Row = { unit_key: "unit_kg", qos_unit_id: "unit_kg", action: "skip", code: "kg", name: "Kilogram", name_ar: "كيلوغرام", standard_code: "kg", quantity_kind: "MASS", decimal_places: "3", active: "TRUE", expected_revision: TOKEN };
const UNIT_G: Row = { ...UNIT_KG, unit_key: "unit_g", qos_unit_id: "unit_g", code: "g", name: "Gram", name_ar: "غرام", standard_code: "g", decimal_places: "0" };
const SUPPLIER: Row = { supplier_key: "sup_1", qos_supplier_id: "sup_1", action: "skip", name: "Farm", active: "TRUE", expected_revision: TOKEN };
const ARCHIVED_SUPPLIER: Row = { ...SUPPLIER, supplier_key: "sup_2", qos_supplier_id: "sup_2", name: "Old farm", active: "FALSE" };
const WAREHOUSE: Row = { warehouse_key: "wh_1", qos_warehouse_id: "wh_1", action: "skip", branch_key: "loc_quotes_hbz", code: "MAIN", name: "Main", active: "TRUE", expected_revision: TOKEN };
const ITEM: Row = { ingredient_key: "item_milk", qos_ingredient_id: "item_milk", action: "skip", name_en: "Milk", ingredient_type: "PURCHASED", storage_unit_key: "unit_kg", recipe_unit_key: "unit_g", recipe_units_per_storage_unit: "1000", active: "TRUE", expected_revision: TOKEN };
const APPROVED: Row = { recipe_version_key: "recv_1", qos_recipe_version_id: "recv_1", action: "skip", recipe_key: "rec_latte", version_number: "1", name: "Latte", target_type: "SOLD_VARIANT", variant_key: "var_flat_white_regular", yield_quantity: "1", yield_unit_key: "unit_g", effective_from: "2026-11-01", expected_revision: TOKEN };
const DRAFT: Row = { ...APPROVED, recipe_version_key: "recv_2", qos_recipe_version_id: "recv_2", version_number: "2", effective_from: "" };
const LINE: Row = { recipe_line_key: "recl_1", qos_recipe_line_id: "recl_1", action: "skip", recipe_version_key: "recv_1", ingredient_key: "item_milk", quantity_recipe_units: "200", sort_order: "1", expected_revision: TOKEN };

function snapshot(records: Record<string, Row[]>) {
  return snapshotFrom({ records: { ...seedRecords(), ...records } });
}

function review(sheets: Record<string, Row[]>, records: Record<string, Row[]> = {}, typedLinks: Array<{ entityType: string; sourceKey: string; targetPublicId: string }> = []): WorkbookReview {
  return reviewWorkbook(qosInput(sheets), snapshotFrom({ records: { ...seedRecords(), ...records }, typedLinks }));
}

const rowOf = (result: WorkbookReview, sheet: string, key: string): ReviewRow => result.rows.find((row) => row.sheet === sheet && row.key === key)!;
const errors = (row: ReviewRow) => row.diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.params?.reason ?? entry.code);

describe("Phase 2 review rules", () => {
  it("is engine qos200.2", () => {
    expect(REVIEW_ENGINE_VERSION).toBe("qos200.2");
  });

  it("reads the active flag as archive and restore, and refuses an inactive create", () => {
    const result = review(
      {
        Suppliers: [
          { ...SUPPLIER, action: "update", active: "FALSE" },
          { ...ARCHIVED_SUPPLIER, action: "update", active: "TRUE" },
          { supplier_key: "s-new", action: "create", name: "New", active: "FALSE" },
        ],
      },
      { Suppliers: [SUPPLIER, ARCHIVED_SUPPLIER] },
    );
    expect(rowOf(result, "Suppliers", "sup_1")).toMatchObject({ classification: "update", operation: "archive" });
    expect(rowOf(result, "Suppliers", "sup_2")).toMatchObject({ classification: "update", operation: "restore" });
    expect(rowOf(result, "Suppliers", "s-new").classification).toBe("invalid");
    expect(errors(rowOf(result, "Suppliers", "s-new"))).toEqual(["create_inactive"]);
  });

  it("adds standard units by code or by name, refuses custom units without code or Arabic name, and offers an existing standard unit", () => {
    const result = review(
      {
        Units: [
          { unit_key: "u1", action: "create", name: "ml", quantity_kind: "VOLUME", decimal_places: "0", active: "TRUE" },
          { unit_key: "u2", action: "create", name: "Tray", quantity_kind: "PACK", decimal_places: "0", active: "TRUE" },
          { unit_key: "u3", action: "create", code: "tray", name: "Large tray", quantity_kind: "PACK", decimal_places: "0", active: "TRUE" },
          { unit_key: "u4", action: "create", standard_code: "kg", name: "Kilo", quantity_kind: "MASS", decimal_places: "3", active: "TRUE" },
          { unit_key: "u5", action: "create", name: "BATCH", code: "batch", name_ar: "دفعة", quantity_kind: "BATCH", decimal_places: "0", active: "TRUE" },
        ],
      },
      { Units: [UNIT_KG] },
    );
    expect(rowOf(result, "Units", "u1").classification).toBe("create");
    expect(errors(rowOf(result, "Units", "u2"))).toEqual(["code_required"]);
    expect(errors(rowOf(result, "Units", "u3"))).toEqual(["arabic_name_required"]);
    expect(rowOf(result, "Units", "u4")).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "unit_kg" })] });
    expect(rowOf(result, "Units", "u5").classification).toBe("create");
    // Code, kind and standard are fixed after create.
    const update = review({ Units: [{ ...UNIT_KG, action: "update", code: "kilo" }] }, { Units: [UNIT_KG] });
    expect(errors(rowOf(update, "Units", "unit_kg"))).toEqual(["immutable_field"]);
  });

  it("checks the storage to recipe factor against the standard conversion and types decimals and dates strictly", () => {
    const result = review(
      {
        Ingredients: [
          { ...ITEM, action: "update", recipe_units_per_storage_unit: "1001" },
          { ingredient_key: "i2", action: "create", name_en: "Flour", ingredient_type: "PURCHASED", storage_unit_key: "unit_kg", recipe_unit_key: "unit_g", recipe_units_per_storage_unit: "1000.0", reference_cost_per_storage_unit: "0", cost_effective_date: "2026-02-30", active: "TRUE" },
          { ingredient_key: "i3", action: "create", name_en: "Rice", ingredient_type: "PURCHASED", storage_unit_key: "unit_kg", recipe_unit_key: "unit_g", recipe_units_per_storage_unit: "0", active: "TRUE" },
        ],
      },
      { Units: [UNIT_KG, UNIT_G], Ingredients: [ITEM] },
    );
    expect(errors(rowOf(result, "Ingredients", "item_milk"))).toEqual(["factor_conflicts_with_standard"]);
    const flour = rowOf(result, "Ingredients", "i2");
    expect(errors(flour)).toEqual(["malformed_date"]);
    // "1000.0" is read exactly as 1000; "0" is a known zero cost, never blank.
    expect(flour.after).toMatchObject({ recipe_units_per_storage_unit: "1000", reference_cost_per_storage_unit: "0" });
    expect(errors(rowOf(result, "Ingredients", "i3"))).toEqual(["value_not_positive"]);
  });

  it("applies the draft policy: an approved version gets a draft, an open draft is a conflict, children need their recipe row", () => {
    const records = { Units: [UNIT_KG, UNIT_G], Ingredients: [ITEM], Recipes: [APPROVED], "Recipe Lines": [LINE] };
    const edited = review({ Recipes: [{ ...APPROVED, action: "update", yield_quantity: "2" }] }, records);
    expect(rowOf(edited, "Recipes", "recv_1")).toMatchObject({ classification: "update", operation: "update" });

    const withDraft = review({ Recipes: [{ ...APPROVED, action: "update", yield_quantity: "2" }] }, { ...records, Recipes: [APPROVED, DRAFT] });
    const conflict = rowOf(withDraft, "Recipes", "recv_1");
    expect(conflict).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "recv_2" })] });
    expect(conflict.diagnostics).toContainEqual(expect.objectContaining({ code: "existing_record_conflict", params: expect.objectContaining({ reason: "draft_exists" }) }));
    const chosen = reviewWorkbook(qosInput({ Recipes: [{ ...APPROVED, action: "update", yield_quantity: "2" }] }), snapshot({ ...records, Recipes: [APPROVED, DRAFT] }), [
      { kind: "match_existing", sheet: "Recipes", row: 7, targetPublicId: "recv_2" },
    ]);
    expect(rowOf(chosen, "Recipes", "recv_1")).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: "recv_2" }) });

    const archived = review({ Recipes: [{ ...APPROVED, action: "archive" }] }, records);
    expect(errors(rowOf(archived, "Recipes", "recv_1"))).toEqual(["version_not_draft"]);

    const lineOnly = review({ "Recipe Lines": [{ ...LINE, action: "update", quantity_recipe_units: "250" }] }, records);
    expect(errors(rowOf(lineOnly, "Recipe Lines", "recl_1"))).toEqual(["recipe_draft_required"]);

    // An unchanged recipe row of the approved version becomes the update that makes the draft for its children.
    const withParent = review({ Recipes: [APPROVED], "Recipe Lines": [{ ...LINE, action: "update", quantity_recipe_units: "250" }] }, records);
    expect(rowOf(withParent, "Recipes", "recv_1")).toMatchObject({ classification: "skipped" });
    const promoted = review({ Recipes: [{ ...APPROVED, action: "update" }], "Recipe Lines": [{ ...LINE, action: "update", quantity_recipe_units: "250" }] }, records);
    expect(rowOf(promoted, "Recipes", "recv_1")).toMatchObject({ classification: "update", operation: "update", changes: [] });
    expect(rowOf(promoted, "Recipes", "recv_1").diagnostics).toContainEqual(expect.objectContaining({ code: "recipe_draft_created" }));
    expect(rowOf(promoted, "Recipe Lines", "recl_1")).toMatchObject({ classification: "update" });
  });

  it("keeps one open draft per recipe and one recipe link per sold variant", () => {
    const records = { Units: [UNIT_KG, UNIT_G], Recipes: [APPROVED] };
    const syrup: Row = { ...ITEM, ingredient_key: "item_syrup", qos_ingredient_id: "item_syrup", name_en: "Syrup", ingredient_type: "PREPARED" };
    const linkedVariant = review(
      { Recipes: [{ recipe_version_key: "a1", action: "create", recipe_key: "fam", name: "Mocha", target_type: "SOLD_VARIANT", yield_quantity: "1", yield_unit_key: "unit_g", variant_key: "var_flat_white_regular" }] },
      records,
    );
    expect(rowOf(linkedVariant, "Recipes", "a1")).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "recv_1" })] });
    expect(rowOf(linkedVariant, "Recipes", "a1").diagnostics).toContainEqual(expect.objectContaining({ params: expect.objectContaining({ reason: "variant_linked_elsewhere" }) }));
    const twoNew = review(
      {
        Recipes: [
          { recipe_version_key: "b1", action: "create", recipe_key: "fam2", name: "Syrup", target_type: "PREPARED_ITEM", prepared_ingredient_key: "item_syrup", yield_quantity: "1", yield_unit_key: "unit_g" },
          { recipe_version_key: "b2", action: "create", recipe_key: "fam2", name: "Syrup batch", target_type: "PREPARED_ITEM", prepared_ingredient_key: "item_syrup", yield_quantity: "2", yield_unit_key: "unit_g" },
        ],
      },
      { ...records, Ingredients: [syrup] },
    );
    expect(rowOf(twoNew, "Recipes", "b1").diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(rowOf(twoNew, "Recipes", "b1").classification).toBe("create");
    expect(errors(rowOf(twoNew, "Recipes", "b2"))).toEqual(["draft_exists"]);
    // A purchased item cannot be a prepared recipe's output.
    const purchased = review(
      { Recipes: [{ recipe_version_key: "c1", action: "create", recipe_key: "fam3", name: "Milk batch", target_type: "PREPARED_ITEM", prepared_ingredient_key: "item_milk", yield_quantity: "1", yield_unit_key: "unit_g" }] },
      { ...records, Ingredients: [ITEM] },
    );
    expect(errors(rowOf(purchased, "Recipes", "c1"))).toEqual(["output_item_not_prepared"]);
    // A new version of a linked family is not a name collision with its own versions.
    const linked = review(
      { Recipes: [{ recipe_version_key: "v-new", action: "create", recipe_key: "r-latte", name: "Latte", target_type: "SOLD_VARIANT", yield_quantity: "1", yield_unit_key: "unit_g" }] },
      records,
      [{ entityType: "recipe", sourceKey: "r-latte", targetPublicId: "rec_latte" }],
    );
    expect(rowOf(linked, "Recipes", "v-new")).toMatchObject({ classification: "create" });
  });

  it("keeps a warehouse with its branch and one active warehouse per branch", () => {
    const records = { Warehouses: [WAREHOUSE] };
    const result = review(
      {
        Warehouses: [
          { ...WAREHOUSE, action: "update", branch_key: "loc_quotes_hct" },
          { warehouse_key: "w-2", action: "create", branch_key: "loc_quotes_hbz", code: "TWO", name: "Two", active: "TRUE" },
          { warehouse_key: "w-3", action: "create", branch_key: "loc_quotes_hct", code: "THREE", name: "Three", active: "TRUE" },
          { warehouse_key: "w-4", action: "create", branch_key: "loc_quotes_hct", code: "FOUR", name: "Four", active: "TRUE" },
        ],
      },
      records,
    );
    expect(errors(rowOf(result, "Warehouses", "wh_1"))).toEqual(["location_immutable"]);
    expect(rowOf(result, "Warehouses", "w-2").classification).toBe("conflicting");
    expect(rowOf(result, "Warehouses", "w-3").classification).toBe("create");
    expect(errors(rowOf(result, "Warehouses", "w-4"))).toEqual(["warehouse_branch_taken"]);
  });

  it("checks effect shapes, keeps deferred step and line columns with their owner and never proposes them", () => {
    const records = { Units: [UNIT_KG, UNIT_G], Ingredients: [ITEM], Recipes: [DRAFT] };
    const result = review(
      {
        "Recipe Lines": [{ recipe_line_key: "l1", action: "create", recipe_version_key: "recv_2", ingredient_key: "item_milk", quantity_recipe_units: "2.5", sort_order: "1", notes: "warm" }],
        "Prep Steps": [{ prep_step_key: "p1", action: "create", recipe_version_key: "recv_2", step_number: "1", title: "Steam", instruction: "Steam it", expected_minutes: "2", checkpoint_required: "TRUE" }],
        "Modifier Effects": [
          { effect_key: "e1", action: "create", modifier_option_key: "opt_oat", recipe_version_key: "recv_2", effect_type: "ADD", target_recipe_line_key: "l1", ingredient_key: "item_milk", quantity_per_sold_unit: "1" },
          { effect_key: "e2", action: "create", modifier_option_key: "opt_oat", recipe_version_key: "recv_2", effect_type: "REMOVE", target_recipe_line_key: "l1", ingredient_key: "item_milk" },
        ],
      },
      records,
    );
    // The recipe unit g allows no decimal places.
    expect(errors(rowOf(result, "Recipe Lines", "l1"))).toEqual(["quantity_too_precise"]);
    const step = rowOf(result, "Prep Steps", "p1");
    expect(step.classification).toBe("create");
    expect(step.deferredFields.map((field) => field.column).sort()).toEqual(["checkpoint_required", "expected_minutes", "title"]);
    expect(Object.keys(step.after ?? {})).not.toEqual(expect.arrayContaining(["title"]));
    expect(rowOf(result, "Recipe Lines", "l1").deferredFields).toEqual([
      { column: "notes", value: "warm", owner: "Recipe editor: line notes have no field yet; line labels are edited in the recipe editor" },
    ]);
    expect(errors(rowOf(result, "Modifier Effects", "e1"))).toEqual(["target_line_not_allowed"]);
    expect(errors(rowOf(result, "Modifier Effects", "e2"))).toEqual(["effect_item_not_allowed"]);
  });
  describe("an open draft reached through a workbook key (QOS-200 follow-up)", () => {
    const records = { Units: [UNIT_KG, UNIT_G], Ingredients: [ITEM], Recipes: [APPROVED, DRAFT] };
    const template = { keysVerified: false, isExport: false };
    const keyLink = { entityType: "recipe_version", sourceKey: "rv-1", targetPublicId: "recv_2", planId: "plan-a" };
    const edit = { recipe_version_key: "rv-1", action: "update", yield_quantity: "2" };

    it("is Conflicting with that draft for a new upload; the plan that moved the key follows it; choosing the draft resolves it", () => {
      const source = { records: { ...seedRecords(), ...records }, typedLinks: [keyLink] };
      const fresh = reviewWorkbook(qosInput({ Recipes: [edit] }, template), snapshotFrom(source));
      const conflict = rowOf(fresh, "Recipes", "rv-1");
      expect(conflict).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "recv_2" })] });
      expect(conflict.diagnostics).toContainEqual(expect.objectContaining({ code: "existing_record_conflict", params: expect.objectContaining({ reason: "draft_exists" }) }));

      const retry = reviewWorkbook(qosInput({ Recipes: [edit] }, template), snapshotFrom(source), [], { planId: "plan-a" });
      expect(rowOf(retry, "Recipes", "rv-1")).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: "recv_2" }) });

      const chosen = reviewWorkbook(qosInput({ Recipes: [edit] }, template), snapshotFrom(source), [{ kind: "match_existing", sheet: "Recipes", row: 7, key: "rv-1", targetPublicId: "recv_2" }]);
      expect(rowOf(chosen, "Recipes", "rv-1")).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: "recv_2" }) });

      // A link with no known plan is never treated as this plan's.
      const unknown = reviewWorkbook(qosInput({ Recipes: [edit] }, template), snapshotFrom({ ...source, typedLinks: [{ ...keyLink, planId: null }] }), [], { planId: "plan-a" });
      expect(rowOf(unknown, "Recipes", "rv-1").classification).toBe("conflicting");
    });

    it("does not follow an approved version named by id to a draft another plan made", () => {
      const source = { records: { ...seedRecords(), ...records }, typedLinks: [{ entityType: "recipe_version", sourceKey: "recv_1", targetPublicId: "recv_2", planId: "plan-a" }] };
      const row = { ...APPROVED, action: "update", yield_quantity: "2" };
      const fresh = reviewWorkbook(qosInput({ Recipes: [row] }), snapshotFrom(source));
      expect(rowOf(fresh, "Recipes", "recv_1")).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "recv_2" })] });
      const retry = reviewWorkbook(qosInput({ Recipes: [row] }), snapshotFrom(source), [], { planId: "plan-a" });
      expect(rowOf(retry, "Recipes", "recv_1")).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: "recv_2" }) });
    });

    it("matches a child row whose link still names the approved version's record to its copy on the draft", () => {
      const copy: Row = { ...LINE, recipe_line_key: "recl_2", qos_recipe_line_id: "recl_2", recipe_version_key: "recv_2" };
      const source = {
        records: { ...seedRecords(), ...records, "Recipe Lines": [LINE, copy] },
        typedLinks: [keyLink, { entityType: "recipe_line", sourceKey: "l-1", targetPublicId: "recl_1", planId: "plan-a" }],
      };
      const sheets = { Recipes: [edit], "Recipe Lines": [{ recipe_line_key: "l-1", action: "update", recipe_version_key: "rv-1", quantity_recipe_units: "250" }] };
      const retry = reviewWorkbook(qosInput(sheets, template), snapshotFrom(source), [], { planId: "plan-a" });
      expect(rowOf(retry, "Recipe Lines", "l-1")).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: "recl_2" }) });
      expect(rowOf(retry, "Recipe Lines", "l-1").changes).toEqual([expect.objectContaining({ column: "quantity_recipe_units", before: "200", after: "250" })]);
      // A new upload: the recipe row is Conflicting and its line waits for that decision.
      const fresh = reviewWorkbook(qosInput(sheets, template), snapshotFrom(source));
      expect(rowOf(fresh, "Recipes", "rv-1").classification).toBe("conflicting");
      expect(rowOf(fresh, "Recipe Lines", "l-1")).toMatchObject({ classification: "blocked" });
    });

    it("keeps the snapshot hash independent of which plan wrote a link", () => {
      const base = { records: { ...seedRecords(), ...records }, permittedBranches: [], brandPublicId: "brd_quotes" };
      expect(snapshotHashOf({ ...base, typedLinks: [keyLink] })).toBe(snapshotHashOf({ ...base, typedLinks: [{ ...keyLink, planId: undefined }] }));
    });
  });
});
