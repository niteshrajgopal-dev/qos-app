import type ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { WORKBOOK_CONTRACT } from "@/lib/workbook/contract";
import { FIELD_CAPABILITIES } from "@/lib/workbook/apply/capability";
import { CAPABILITIES, capabilityFor, SOURCE_MAP_SHEET, WORKBOOK_DICTIONARY_VERSION } from "@/lib/workbook/dictionary";
import { WorkbookParseError } from "@/lib/workbook/errors";
import {
  buildFoodicsMenuFixture,
  FILLED_RECORDS,
  FIXTURE_SHEETS,
  FOODICS_FIXTURE_FILE_NAME,
  writeRow,
  type FoodicsFixtureOptions,
} from "@/lib/workbook/foodics-menu/fixture";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";
import { parseWorkbookUpload, type WorkbookIssue, type WorkbookParseOptions } from "@/lib/workbook/reader";

const OPTIONS: WorkbookParseOptions = { tenantCurrency: "AED", tenantPublicId: "ten_test", brandChoices: [{ publicId: "brd_one", name: "One" }] };

async function parse(fixture: FoodicsFixtureOptions = {}, options: WorkbookParseOptions = OPTIONS) {
  const result = await parseWorkbookUpload(
    { fileName: FOODICS_FIXTURE_FILE_NAME, bytes: await buildFoodicsMenuFixture({ prefillLastRow: 60, ...fixture }) },
    options,
  );
  expect(result.profile).toBe("foodics_menu_v1");
  return result as FoodicsMenuParseResult;
}

function rows(result: FoodicsMenuParseResult, sheet: string) {
  return result.sheets.find((entry) => entry.sheet === sheet)!.rows;
}

function values(result: FoodicsMenuParseResult, sheet: string) {
  return rows(result, sheet).map((row) => row.values);
}

function issuesWith(result: FoodicsMenuParseResult, code: WorkbookIssue["code"]) {
  return result.issues.filter((issue) => issue.code === code);
}

function at(issue: WorkbookIssue) {
  return `${issue.sheet}!${issue.params?.cell}`;
}

function sheetOf(workbook: ExcelJS.Workbook, name: string) {
  return workbook.getWorksheet(name)!;
}

describe("untouched Foodics menu workbook", () => {
  it("yields zero business rows: examples, formulas, dashboards and validations never become candidates", async () => {
    const result = await parse({ prefillLastRow: 2148 });
    for (const sheet of result.sheets) {
      expect(sheet.rowCount, sheet.sheet).toBe(0);
    }
    expect(result.summary).toMatchObject({ errors: 0, recognizedRows: 0, deferredRows: 0, deferredValues: 0 });
    expect(result.summary.supported.rows).toBe(0);
    expect(result.capabilities).toEqual([]);
    expect(result.layout.regions.every((region) => region.businessRows === 0)).toBe(true);
    expect(issuesWith(result, "example_rows_skipped").map((issue) => [issue.sheet, issue.params?.range, issue.params?.populated])).toEqual([
      ["Categories", "F5:G7", 3],
      ["Products", "D7:V10", 4],
      ["Ingredients", "D8:J17", 10],
      ["Ingredients", "L8:N14", 7],
      ["Modifiers", "F9:O12", 4],
      ["Modifiers", "R9:T12", 4],
      ["Product Modifiers", "D7:I8", 2],
      ["Prepared Items", "I7:K9", 3],
    ]);
    // Example text is never copied into the result.
    expect(JSON.stringify(result)).not.toContain("Example product");
    expect(result.issues.filter((issue) => issue.severity !== "info")).toEqual([]);
  });
});

describe("formula cells", () => {
  it("never makes a row from formulas, withholds them in business rows and never reads cached values", async () => {
    const result = await parse({
      edit: (workbook) => {
        const ingredients = sheetOf(workbook, FIXTURE_SHEETS.ingredients);
        writeRow(ingredients, "D18", ["Butter"]);
        ingredients.getCell("D19").value = { formula: 'UPPER("cached-identity")', result: "CACHED-IDENTITY" };
        writeRow(ingredients, "F19", ["kg"]);
        ingredients.getCell("I20").value = { formula: "1+1", result: 2 };
      },
    });
    expect(values(result, "Ingredients")).toEqual([
      expect.objectContaining({ name_en: "Butter", recipe_unit_key: "", recipe_units_per_storage_unit: "", storage_unit_key: "" }),
    ]);
    expect(issuesWith(result, "formula_ignored").map(at)).toEqual(["Ingredients!G18", "Ingredients!H18"]);
    expect(issuesWith(result, "identity_formula").map(at)).toEqual(["Ingredients!D19"]);
    expect(JSON.stringify(result)).not.toContain("CACHED-IDENTITY");
    // Row 20 has only a formula and the G/H prefill: not a row, no issue.
    expect(result.issues.filter((issue) => issue.row === 20)).toEqual([]);
  });
});

describe("filled sanitized fixture", () => {
  it("reads every business area into canonical rows with stable keys, exact money and provenance", async () => {
    const result = await parse({ filled: true });
    const counts = Object.fromEntries(result.sheets.filter((sheet) => sheet.rowCount > 0).map((sheet) => [sheet.sheet, sheet.rowCount]));
    expect(counts).toEqual({
      Categories: 2,
      Products: 3,
      "Product Categories": 3,
      Variants: 3,
      "Modifier Groups": 1,
      "Modifier Options": 2,
      "Product Modifiers": 2,
      Units: 4,
      "Inventory Categories": 3,
      Ingredients: 3,
      Recipes: 3,
      "Recipe Lines": 4,
      "Modifier Effects": 1,
    });
    expect(rows(result, "Branch Prices")).toEqual([]);
    // QOS-200: units, inventory categories, ingredients, recipes, lines and effects are supported sheets now.
    expect(result.summary).toMatchObject({ errors: 0, recognizedRows: 34, deferredRows: 0 });
    // Tax columns (3 + 3), free options (2), channel prices (13), product cost (1), selling method (2),
    // status (3), preparation time (1), option cost (2) and calories (2), assignment required (2);
    // recipe version numbers (3, QOS assigns them); not the exact-text copies of imported prices and costs.
    expect(result.summary.deferredValues).toBe(37);

    const keys = Object.fromEntries(
      result.sheets
        .filter((sheet) => sheet.rowCount > 0)
        .map((sheet) => [sheet.sheet, sheet.rows.map((row) => row.values[WORKBOOK_CONTRACT.sheets.find((entry) => entry.name === sheet.sheet)!.columns[0]!.key])]),
    );
    expect(keys).toEqual({
      Categories: ["cat~hot-drinks~84dfc7b6", "cat~cb9ae49d"],
      Products: ["prd~flat-white~45e955ba", "prd~vanilla-latte~48102bbb", "prd~7d842ea9"],
      "Product Categories": [
        "prd~flat-white~45e955ba~cat~hot-drinks~84dfc7b6",
        "prd~vanilla-latte~48102bbb~cat~hot-drinks~84dfc7b6",
        "prd~7d842ea9~cat~cb9ae49d",
      ],
      Variants: ["prd~flat-white~45e955ba~default", "prd~vanilla-latte~48102bbb~default", "prd~7d842ea9~default"],
      "Modifier Groups": ["grp~extras~535a380a"],
      "Modifier Options": ["grp~extras~535a380a~opt~extra-syrup~1ae29953", "grp~extras~535a380a~opt~oat-milk~0b80cd32"],
      "Product Modifiers": ["prd~flat-white~45e955ba~grp~extras~535a380a", "prd~vanilla-latte~48102bbb~grp~extras~535a380a"],
      Units: ["unit~l~76736809", "unit~ml~bf35ea95", "unit~kg~06ac13d0", "unit~g~15053502"],
      "Inventory Categories": ["invcat~dairy~7c50ce94", "invcat~dry-goods~ce904e70", "invcat~prepared~ffa65a7b"],
      Ingredients: ["ing~whole-milk~b87013cf", "ing~sugar~383d4e34", "ing~vanilla-syrup~ff527961"],
      Recipes: ["rcp~product-flat-white~380edd5a~v1", "rcp~product-vanilla-latte~58f06c42~v1", "rcp~prepared-vanilla-syrup~2c52eba4~v1"],
      "Recipe Lines": [
        "rcp~product-flat-white~380edd5a~v1~1",
        "rcp~product-vanilla-latte~58f06c42~v1~1",
        "rcp~prepared-vanilla-syrup~2c52eba4~v1~1",
        "rcp~prepared-vanilla-syrup~2c52eba4~v1~2",
      ],
      "Modifier Effects": ["grp~extras~535a380a~opt~extra-syrup~1ae29953~eff~vanilla-syrup~8016a565"],
    });

    // Every converted row is a first intake of a draft, with no invented QOS id or revision.
    for (const sheet of result.sheets) {
      for (const row of sheet.rows) {
        expect(row.values.action, sheet.sheet).toBe("create");
        expect(row.values.expected_revision, sheet.sheet).toBe("");
        for (const [column, value] of Object.entries(row.values)) {
          if (column.startsWith("qos_")) expect(value, `${sheet.sheet}.${column}`).toBe("");
        }
        if ("status" in row.values) expect(row.values.status).toBe("draft");
      }
    }

    const [flatWhite] = rows(result, "Variants");
    expect(values(result, "Variants").every((variant) => variant.is_default === "TRUE")).toBe(true);
    expect(flatWhite!.values).toMatchObject({
      amount_minor: "1250",
      currency: "AED",
      tax_rate_basis_points: "500",
      price_tax_basis: "UNCONFIRMED",
      sku: "000123",
      barcode: "0062911234567",
    });
    expect(flatWhite!.source).toMatchObject({
      sheet: "Products",
      row: 11,
      range: "Products!D11:V11",
      values: { price: "12.50", tax: "5%" },
      preserved: { price: { value: "12.50", cell: "Products!K11" }, tax: { value: "5%", cell: "Products!P11" } },
    });
    expect(values(result, "Variants").map((variant) => variant.amount_minor)).toEqual(["1250", "1800", "600"]);
    expect(rows(result, "Products")[0]!.source).toMatchObject({
      cells: { display_name_en: "Products!D11", display_name_ar: "Products!E11", barcode: "Products!J11" },
      preserved: {
        "channel_price:dine in": { value: "13.00", cell: "Products!L11" },
        product_cost: { value: "4.20", cell: "Products!Q11" },
        selling_method: { value: "Unit", cell: "Products!R11" },
        source_status: { value: "Yes", cell: "Products!S11" },
        preparation_time: { value: "5", cell: "Products!U11" },
      },
    });
    expect(values(result, "Products")[0]).toMatchObject({ nutrition_calories: "320", image_url: "https://images.example.test/flat-white.jpg" });
    expect(values(result, "Modifier Options").map((option) => option.price_minor)).toEqual(["200", "300"]);
    expect(values(result, "Modifier Groups")[0]).toMatchObject({ min_selections: "0", max_selections: "2", display_name_ar: "إضافات" });
    expect(values(result, "Product Modifiers").map((row) => row.free_options_count)).toEqual(["0", "1"]);
    expect(values(result, "Ingredients").map((row) => [row.ingredient_type, row.reference_cost_per_storage_unit, row.cost_tax_basis])).toEqual([
      ["PURCHASED", "6.50", "UNCONFIRMED"],
      ["PURCHASED", "3.25", "UNCONFIRMED"],
      ["PREPARED", "", ""],
    ]);
    expect(values(result, "Recipes").map((row) => [row.target_type, row.variant_key, row.prepared_ingredient_key, row.yield_unit_key])).toEqual([
      ["SOLD_VARIANT", "prd~flat-white~45e955ba~default", "", ""],
      ["SOLD_VARIANT", "prd~vanilla-latte~48102bbb~default", "", ""],
      ["PREPARED_ITEM", "", "ing~vanilla-syrup~ff527961", ""],
    ]);
    expect(values(result, "Modifier Effects")[0]).toMatchObject({ effect_type: "ADD", recipe_version_key: "", quantity_per_sold_unit: "0.015" });
    // Prepared recipes never post production.
    for (const sheet of ["Prep Targets", "Opening Stock", "Prep Steps", "Future Combos", "Combo Components"]) {
      expect(rows(result, sheet), sheet).toEqual([]);
    }

    expect(result.requiredMappings).toEqual([
      { kind: "currency", status: "resolved", value: "AED" },
      { kind: "brand", status: "resolved", value: "brd_one" },
      { kind: "namespace", status: "resolved", value: "foodics-menu-v1:ten_test" },
      { kind: "channel", status: "deferred", label: "dine in", prices: 4 },
      { kind: "channel", status: "deferred", label: "takeaway", prices: 4 },
      { kind: "channel", status: "deferred", label: "delivery", prices: 5 },
    ]);
    expect(result.context).toEqual({ tenantPublicId: "ten_test", brandPublicId: "brd_one", currency: "AED", sourceNamespace: "foodics-menu-v1:ten_test" });
  });

  it("converts the same file to the same result every time", async () => {
    // Build the fixture once. ExcelJS/ZIP timestamps make two writes a second
    // apart produce different bytes, which is not "the same file".
    const bytes = await buildFoodicsMenuFixture({ prefillLastRow: 60, filled: true });
    const file = { fileName: FOODICS_FIXTURE_FILE_NAME, bytes };
    const first = (await parseWorkbookUpload(file, OPTIONS)) as FoodicsMenuParseResult;
    const second = (await parseWorkbookUpload(file, OPTIONS)) as FoodicsMenuParseResult;
    expect(first.profile).toBe("foodics_menu_v1");
    expect(second.sheets).toEqual(first.sheets);
    expect(second.fileFingerprint).toBe(first.fileFingerprint);
  });

  it("keeps Arabic text byte for byte and identifiers as typed", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        sheetOf(workbook, FIXTURE_SHEETS.products).getCell("J12").value = 62911234574;
      },
    });
    const products = values(result, "Products");
    expect(Buffer.from(products[0]!.display_name_ar!)).toEqual(Buffer.from(String(FILLED_RECORDS.products[0]![1])));
    expect(Buffer.from(products[2]!.description_ar!)).toEqual(Buffer.from(String(FILLED_RECORDS.products[2]![3])));
    expect(values(result, "Categories")[1]!.display_name_ar).toBe("مشروبات خاصة");
    expect(products.map((product) => product.sku)).toEqual(["000123", "000124", "000125"]);
    expect(products[0]!.barcode).toBe("0062911234567");
    expect(products[1]!.barcode).toBe("62911234574");
    expect(issuesWith(result, "identifier_number").map(at)).toEqual(["Products!J12"]);
  });

  it("offers a menu-focused path: no ingredient rows means no deferred rows or deferred-sheet notes", async () => {
    const result = await parse({
      edit: (workbook) => {
        FILLED_RECORDS.categories.forEach((record, index) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.categories), `F${8 + index}`, record));
        FILLED_RECORDS.products.forEach((record, index) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.products), `D${11 + index}`, record));
        FILLED_RECORDS.modifiers.forEach((record, index) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.modifiers), `F${13 + index}`, record));
        FILLED_RECORDS.assignments.forEach((record, index) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.assignments), `D${9 + index}`, record));
      },
    });
    expect(result.summary.deferredRows).toBe(0);
    expect(result.summary.recognizedRows).toBe(16);
    expect(result.sheets.flatMap((sheet) => sheet.issues).filter((issue) => issue.code === "deferred_sheet")).toEqual([]);
    expect(result.summary.errors).toBe(0);
  });
});

describe("source-cell errors", () => {
  it("reports unresolved references, near and exact duplicates at their source cells and never merges", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        const products = sheetOf(workbook, FIXTURE_SHEETS.products);
        products.getCell("H12").value = "Cold drinks";
        writeRow(products, "D14", ["flat white", "", "", "", "Hot drinks", "", "", "9"]);
        writeRow(products, "D15", ["Karak Tea", "كرك", "", "", "Hot drinks", "", "", "5"]);
        writeRow(products, "D16", ["Karak Tea", "", "", "", "Hot drinks", "", "", "5"]);
        sheetOf(workbook, FIXTURE_SHEETS.ingredients).getCell("M15").value = "Cream";
      },
    });
    const unresolved = issuesWith(result, "unresolved_reference");
    expect(unresolved.map(at)).toEqual(["Products!H12", "Ingredients!M15"]);
    expect(unresolved[0]!.params).toMatchObject({ field: "category", value: "Cold drinks" });
    expect(values(result, "Product Categories").map((row) => row.product_key)).not.toContain("prd~vanilla-latte~48102bbb");
    // The product itself is still converted.
    expect(values(result, "Products").map((row) => row.display_name_en)).toEqual(["Flat White", "Vanilla Latte", "", "flat white"]);

    expect(issuesWith(result, "ambiguous_identity").map((issue) => [issue.row, issue.params?.value])).toEqual([
      [11, "Flat White"],
      [14, "flat white"],
    ]);
    expect(issuesWith(result, "duplicate_identity").map((issue) => [at(issue), issue.params?.rows])).toEqual([
      ["Products!D15", "15, 16"],
      ["Products!D16", "15, 16"],
    ]);
    expect(issuesWith(result, "duplicate_identity").every((issue) => issue.severity === "error")).toBe(true);
    expect(values(result, "Recipe Lines")).toHaveLength(3);
  });

  it("refuses ambiguous option references and resolves a qualified Group / Option", async () => {
    const ambiguous = await parse({
      filled: true,
      edit: (workbook) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.modifiers), "F15", ["Milk", "الحليب", "Extra syrup", "", "1"]),
    });
    expect(issuesWith(ambiguous, "ambiguous_reference").map(at)).toEqual(["Modifiers!R13"]);
    expect(values(ambiguous, "Modifier Effects")).toEqual([]);

    const qualified = await parse({
      filled: true,
      edit: (workbook) => {
        const modifiers = sheetOf(workbook, FIXTURE_SHEETS.modifiers);
        writeRow(modifiers, "F15", ["Milk", "الحليب", "Extra syrup", "", "1"]);
        modifiers.getCell("R13").value = "Milk / Extra syrup";
      },
    });
    expect(issuesWith(qualified, "ambiguous_reference")).toEqual([]);
    expect(values(qualified, "Modifier Effects")[0]!.modifier_option_key).toMatch(/^grp~milk~[0-9a-f]{8}~opt~extra-syrup~/);
  });

  it("never rounds money and reports unreadable numbers with their exact text", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        const products = sheetOf(workbook, FIXTURE_SHEETS.products);
        products.getCell("K11").value = "12.505";
        products.getCell("K12").value = "abc";
        products.getCell("P13").value = "Standard VAT";
      },
    });
    expect(issuesWith(result, "price_precision").map((issue) => [at(issue), issue.params?.value])).toEqual([["Products!K11", "12.505"]]);
    expect(issuesWith(result, "invalid_number").map((issue) => [at(issue), issue.params?.value])).toEqual([["Products!K12", "abc"]]);
    expect(issuesWith(result, "tax_unresolved").map(at)).toEqual(["Products!P13"]);
    expect(values(result, "Variants").map((row) => [row.amount_minor, row.tax_rate_basis_points, row.price_tax_basis])).toEqual([
      ["", "500", "UNCONFIRMED"],
      ["", "500", "UNCONFIRMED"],
      ["600", "", "UNCONFIRMED"],
    ]);
    expect(rows(result, "Variants")[2]!.source?.preserved?.tax).toEqual({ value: "Standard VAT", cell: "Products!P13" });
  });

  it("reads a bare tax fraction 0.05 as 5% and Inclusive/Exclusive as price_tax_basis", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        const products = sheetOf(workbook, FIXTURE_SHEETS.products);
        products.getCell("V6").value = "Type of tax";
        products.getCell("P11").value = "0.05";
        products.getCell("V11").value = "Inclusive";
        products.getCell("V12").value = "Exclusive";
      },
    });
    expect(values(result, "Variants").map((row) => [row.tax_rate_basis_points, row.price_tax_basis])).toEqual([
      ["500", "INCLUSIVE"],
      ["500", "EXCLUSIVE"],
      ["500", "UNCONFIRMED"],
    ]);
  });

  it("leaves conflicting group limits blank and flags every conflicting cell", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        sheetOf(workbook, FIXTURE_SHEETS.assignments).getCell("G10").value = "3";
      },
    });
    expect(issuesWith(result, "assignment_rule_conflict").map(at)).toEqual(["Product Modifiers!G9", "Product Modifiers!G10"]);
    expect(values(result, "Modifier Groups")[0]).toMatchObject({ min_selections: "0", max_selections: "" });
  });

  it("folds a required rule without a minimum into min 1", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        const assignments = sheetOf(workbook, FIXTURE_SHEETS.assignments);
        for (const row of [9, 10]) {
          assignments.getCell(`F${row}`).value = null;
          assignments.getCell(`H${row}`).value = "Yes";
        }
      },
    });
    expect(values(result, "Modifier Groups")[0]).toMatchObject({ min_selections: "1" });
    expect(rows(result, "Product Modifiers")[0]!.source?.preserved?.assignment_required).toEqual({ value: "Yes", cell: "Product Modifiers!H9" });
  });

  it("keeps unknown columns as unmapped source values instead of dropping or guessing them", async () => {
    const result = await parse({
      filled: true,
      edit: (workbook) => {
        const products = sheetOf(workbook, FIXTURE_SHEETS.products);
        products.getCell("R6").value = "Kitchen station";
        products.getCell("R11").value = "Bar";
      },
    });
    expect(issuesWith(result, "source_column_unmapped").map((issue) => [at(issue), issue.params?.header])).toEqual([
      ["Products!R6", "Kitchen station"],
    ]);
    expect(rows(result, "Products")[0]!.source?.preserved?.["unmapped:kitchen station"]).toEqual({ value: "Bar", cell: "Products!R11" });
    expect(capabilityFor(SOURCE_MAP_SHEET, "unmapped:kitchen station")?.class).toBe("deferred");
  });
});

describe("over-limit input", () => {
  it("reads typed rows up to the bound and refuses typed identity text past it", async () => {
    const within = await parse({
      edit: (workbook) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.products), "D1010", ["Late item", "", "", "", "", "", "", "1"]),
      prefillLastRow: 2148,
    });
    expect(rows(within, "Products").map((row) => row.source?.row)).toEqual([1010]);

    let error: unknown;
    try {
      await parse({ edit: (workbook) => writeRow(sheetOf(workbook, FIXTURE_SHEETS.products), "D1011", ["Too late"]) });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WorkbookParseError);
    expect((error as WorkbookParseError).code).toBe("too_many_rows");
    expect((error as WorkbookParseError).params).toEqual({ sheet: "Products", region: "products", lastTypedRow: 1011, max: 1000 });
  });
});

describe("ignored sheets", () => {
  it("never reads guidance, dashboard, list or account sheets into the result", async () => {
    const sentinel = "SENTINEL-must-not-leak-216";
    const result = await parse({ filled: true, sentinel });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(JSON.stringify(result)).not.toContain("Instruction step");
    expect(result.layout.ignoredSheets.map((sheet) => sheet.sheet)).toEqual(["Instructions", "Dashboard", "Lists", "Users"]);
  });
});

describe("field dictionary 1.2", () => {
  it("classifies every value the adapter emits; only the Phase 2 domain columns the apply writes are persistable", async () => {
    const result = await parse({ filled: true });
    expect(WORKBOOK_DICTIONARY_VERSION).toBe("1.2");
    expect(result.dictionaryVersion).toBe("1.2");
    for (const sheet of result.sheets) {
      for (const row of sheet.rows) {
        for (const [column, value] of Object.entries(row.values)) {
          if (value) expect(capabilityFor(sheet.sheet, column), `${sheet.sheet}.${column}`).not.toBeNull();
        }
        for (const field of Object.keys(row.source?.preserved ?? {})) {
          expect(capabilityFor(SOURCE_MAP_SHEET, field), field).not.toBeNull();
        }
      }
    }
    expect(result.capabilities.every((entry) => entry.owner !== "")).toBe(true);
    expect(CAPABILITIES.filter((entry) => entry.class === "validated")).toEqual([]);
    const phase2 = ["Units", "Suppliers", "Warehouses", "Inventory Categories", "Ingredients", "Recipes", "Recipe Lines", "Prep Steps", "Modifier Effects"];
    const persistable = CAPABILITIES.filter((entry) => entry.class === "persistable");
    expect(new Set(persistable.map((entry) => entry.sheet))).toEqual(new Set(phase2));
    for (const sheet of phase2) {
      const data = persistable
        .filter((entry) => entry.sheet === sheet)
        .map((entry) => entry.column)
        .filter((column) => {
          const definition = WORKBOOK_CONTRACT.sheets.find((candidate) => candidate.name === sheet)!.columns.find((candidate) => candidate.key === column)!;
          return column !== "action" && !definition.isKey && definition.type !== "reference";
        });
      // Persistable means a handler sends it to a service: exactly the apply capabilities.
      expect([...data].sort(), sheet).toEqual([...FIELD_CAPABILITIES[sheet as keyof typeof FIELD_CAPABILITIES]].sort());
    }
    // Free-option allowances, channel prices and tax stay deferred.
    expect(capabilityFor("Product Modifiers", "free_options_count")?.class).toBe("deferred");
    expect(capabilityFor("Variants", "tax_rate_basis_points")?.class).toBe("deferred");
    expect(capabilityFor(SOURCE_MAP_SHEET, "channel_price:dine in")?.class).toBe("deferred");
  });

  it("stays compatible with contract v1.0: every classified column exists in the contract", () => {
    for (const entry of CAPABILITIES.filter((capability) => capability.sheet !== SOURCE_MAP_SHEET)) {
      const sheet = WORKBOOK_CONTRACT.sheets.find((candidate) => candidate.name === entry.sheet);
      expect(sheet, entry.sheet).toBeDefined();
      expect(sheet!.columns.some((column) => column.key === entry.column), `${entry.sheet}.${entry.column}`).toBe(true);
    }
  });
});

describe("currency and brand context", () => {
  it("parses without a currency but converts no money and says why", async () => {
    const result = await parse({ filled: true }, { tenantPublicId: "ten_test" });
    expect(issuesWith(result, "currency_required")).toEqual([{ severity: "error", code: "currency_required" }]);
    expect(values(result, "Variants").map((row) => [row.amount_minor, row.currency])).toEqual([
      ["", ""],
      ["", ""],
      ["", ""],
    ]);
    expect(result.requiredMappings[0]).toEqual({ kind: "currency", status: "required" });
  });

  it("refuses to guess money for a currency without known minor units", async () => {
    const result = await parse({ filled: true }, { tenantPublicId: "ten_test", tenantCurrency: "XYZ" });
    expect(issuesWith(result, "currency_minor_digits_unknown")[0]!.params).toEqual({ currency: "XYZ" });
    expect(values(result, "Variants").every((row) => row.amount_minor === "")).toBe(true);
  });

  it("converts minor units by the tenant currency", async () => {
    const result = await parse({ filled: true }, { tenantPublicId: "ten_test", tenantCurrency: "KWD" });
    expect(values(result, "Variants").map((row) => row.amount_minor)).toEqual(["12500", "18000", "6000"]);
  });

  it("asks for a brand when the business has several", async () => {
    const choices = [
      { publicId: "brd_a", name: "A" },
      { publicId: "brd_b", name: "B" },
    ];
    const result = await parse({}, { ...OPTIONS, brandChoices: choices });
    expect(result.requiredMappings[1]).toEqual({ kind: "brand", status: "required", choices });
    const chosen = await parse({}, { ...OPTIONS, brandChoices: choices, brandPublicId: "brd_b" });
    expect(chosen.requiredMappings[1]).toEqual({ kind: "brand", status: "resolved", value: "brd_b" });
  });
});
