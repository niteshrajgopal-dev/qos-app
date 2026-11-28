import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS } from "@/lib/catalogue/catalogue-import-parser";
import {
  columnExpectedInVersion,
  contractSheet,
  isDeferredField,
  sheetExpectedInVersion,
  sheetSupport,
  SUPPORTED_TEMPLATE_VERSIONS,
  SUPPORTED_ENTITY_SHEETS,
  tableColumnKeys,
  tableNameForSheet,
  WORKBOOK_CONTRACT,
  WORKBOOK_SHEET_ORDER,
} from "@/lib/workbook/contract";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { readXlsxPackage } from "@/lib/workbook/ooxml";
import { buildBlankWorkbookTemplate } from "@/lib/workbook/template";
import { loadWorkbook } from "@/lib/workbook/test-support";

/* v1.4 (QOS-215): the pack's v1.0 contract (SHA-256 d36471c7…8520c) plus the
   four QOS-212 assignment policy columns (v1.1, `since: "1.1"`), the three
   sales-channel sheets (v1.2, `sinceVersion: "1.2"`), the eight QOS-214
   selling-attribute columns (v1.3, `sinceVersion: "1.3"`) and the sixteen
   QOS-215 reference-cost columns (v1.4, `sinceVersion: "1.4"`). Tax
   interpretation columns already in v1.0 now map to catalogue_variants. */
const CONTRACT_SHA256 = "acf4047ca0e8b23f6eae84366f37ba390e2d0abd446a005e3a8182a8cf574a5b";
const CHANNEL_SHEETS = ["Sales Channels", "Variant Channel Prices", "Modifier Option Channel Prices"];
const SELLING_ATTRIBUTE_COLUMNS = [
  "Products.preparation_time_minutes@1.3",
  "Products.walking_time_minutes@1.3",
  "Products.high_salt@1.3",
  "Products.is_stock_product@1.3",
  "Variants.selling_quantity_basis@1.3",
  "Variants.price_unit@1.3",
  "Variants.price_unit_quantity@1.3",
  "Modifier Options.nutrition_calories@1.3",
];

const COST_COLUMNS = [
  "Variants.cost_method@1.4",
  "Variants.reference_cost_amount@1.4",
  "Variants.cost_currency@1.4",
  "Variants.cost_unit@1.4",
  "Variants.cost_tax_basis@1.4",
  "Variants.cost_effective_date@1.4",
  "Variants.cost_source@1.4",
  "Variants.cost_source_reference@1.4",
  "Modifier Options.cost_method@1.4",
  "Modifier Options.reference_cost_amount@1.4",
  "Modifier Options.cost_currency@1.4",
  "Modifier Options.cost_unit@1.4",
  "Modifier Options.cost_tax_basis@1.4",
  "Modifier Options.cost_effective_date@1.4",
  "Modifier Options.cost_source@1.4",
  "Modifier Options.cost_source_reference@1.4",
];

/* Table ranges of the pack's reference workbook, read from its bytes, plus
   the v1.1, v1.2, v1.3 and v1.4 additions. The generated template must reproduce
   them from the contract alone. v1.1 widens QOS_Product_Modifiers by four
   columns (J to N); v1.2 adds three tables and Start Here lists three more
   sheets, so the context table sits three rows lower than in the pack; v1.3
   widens QOS_Products (P to T), QOS_Variants (R to U) and QOS_Modifier_Options
   (P to Q); v1.4 widens QOS_Variants (U to AC) and QOS_Modifier_Options (Q to Y)
   by the eight cost columns. The field guide lists one row per contract column: 365. */
const PACK_TABLE_REFS: Record<string, string> = {
  QOS_Workbook_Context: "A51:C61",
  QOS_Current_Import: "A1:G501",
  QOS_Branches: "A6:J26",
  QOS_Categories: "A6:K106",
  QOS_Products: "A6:T206",
  QOS_Product_Categories: "A6:I206",
  QOS_Variants: "A6:AC206",
  QOS_Branch_Prices: "A6:K106",
  QOS_Sales_Channels: "A6:H26",
  QOS_Variant_Channel_Prices: "A6:H206",
  QOS_Modifier_Groups: "A6:L106",
  QOS_Modifier_Options: "A6:Y206",
  QOS_Modifier_Option_Channel_Prices: "A6:H206",
  QOS_Product_Modifiers: "A6:N206",
  QOS_Menus: "A6:L56",
  QOS_Menu_Branches: "A6:H106",
  QOS_Menu_Sections: "A6:L106",
  QOS_Menu_Items: "A6:J206",
  QOS_Units: "A6:M106",
  QOS_Suppliers: "A6:M106",
  QOS_Warehouses: "A6:K106",
  QOS_Inventory_Categories: "A6:I106",
  QOS_Ingredients: "A6:U106",
  QOS_Recipes: "A6:Q106",
  QOS_Recipe_Lines: "A6:K206",
  QOS_Prep_Steps: "A6:M106",
  QOS_Modifier_Effects: "A6:M106",
  QOS_Prep_Targets: "A6:N106",
  QOS_Opening_Stock: "A6:N106",
  QOS_External_Mappings: "A6:O106",
  QOS_Future_Combos: "A6:J106",
  QOS_Combo_Components: "A6:K106",
  QOS_Field_Guide: "A6:I375",
};

describe("workbook contract", () => {
  it("is the committed v1.5 contract file: 31 sheets, v1.1 policy columns, v1.2 channel sheets, v1.3 selling-attribute, v1.4 cost and v1.5 Phase 2 identity columns", () => {
    const bytes = readFileSync(path.join(process.cwd(), "src/lib/workbook/qos-workbook-contract.v1.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(CONTRACT_SHA256);
    expect(WORKBOOK_CONTRACT.version).toBe("1.5");
    expect(WORKBOOK_CONTRACT.asOf).toBe("2026-11-28");
    expect(SUPPORTED_TEMPLATE_VERSIONS).toEqual(["1.0", "1.1", "1.2", "1.3", "1.4", "1.5"]);
    expect(WORKBOOK_CONTRACT.sheets).toHaveLength(31);
    expect(WORKBOOK_CONTRACT.sheets.flatMap((sheet) => sheet.columns)).toHaveLength(369);

    const packSheets = WORKBOOK_CONTRACT.sheets.filter((sheet) => !sheet.sinceVersion);
    expect(packSheets).toHaveLength(28);
    expect(packSheets.flatMap((sheet) => sheet.columns)).toHaveLength(348);
    expect(WORKBOOK_CONTRACT.sheets.filter((sheet) => sheet.sinceVersion === "1.2").map((sheet) => sheet.name)).toEqual(
      CHANNEL_SHEETS,
    );
    expect(
      WORKBOOK_CONTRACT.sheets.filter((sheet) => sheet.sinceVersion && sheet.sinceVersion !== "1.2"),
    ).toEqual([]);
    // Only the four assignment policy columns are new in 1.1.
    expect(
      WORKBOOK_CONTRACT.sheets.flatMap((sheet) =>
        sheet.columns.filter((column) => column.since).map((column) => `${sheet.name}.${column.key}@${column.since}`),
      ),
    ).toEqual([
      "Product Modifiers.min_selections@1.1",
      "Product Modifiers.max_selections@1.1",
      "Product Modifiers.repeat_allowed@1.1",
      "Product Modifiers.selection_count_mode@1.1",
    ]);
    // Only the eight selling-attribute columns are new in 1.3; only the sixteen cost columns are new in 1.4.
    expect(
      WORKBOOK_CONTRACT.sheets.flatMap((sheet) =>
        sheet.columns
          .filter((column) => column.sinceVersion === "1.3")
          .map((column) => `${sheet.name}.${column.key}@${column.sinceVersion}`),
      ),
    ).toEqual(SELLING_ATTRIBUTE_COLUMNS);
    expect(
      WORKBOOK_CONTRACT.sheets.flatMap((sheet) =>
        sheet.columns
          .filter((column) => column.sinceVersion === "1.4")
          .map((column) => `${sheet.name}.${column.key}@${column.sinceVersion}`),
      ),
    ).toEqual(COST_COLUMNS);
    // QOS-200: only the four Phase 2 identity columns are new in 1.5.
    expect(
      WORKBOOK_CONTRACT.sheets.flatMap((sheet) =>
        sheet.columns
          .filter((column) => column.sinceVersion === "1.5")
          .map((column) => `${sheet.name}.${column.key}@${column.sinceVersion}`),
      ),
    ).toEqual(["Units.code@1.5", "Units.name_ar@1.5", "Units.standard_code@1.5", "Warehouses.code@1.5"]);
    // Applied Phase 2 columns map to real records; only the deferred ones stay "Proposed".
    for (const name of ["Units", "Suppliers", "Warehouses", "Inventory Categories", "Ingredients", "Recipes", "Recipe Lines", "Prep Steps", "Modifier Effects"]) {
      const proposed = contractSheet(name)
        .columns.filter((column) => !["action", "expected_revision", "clear_fields"].includes(column.key) && column.mapping.startsWith("Proposed"))
        .map((column) => column.key);
      expect(proposed, name).toEqual(
        ({ Recipes: ["version_number", "effective_from", "effective_to"], "Recipe Lines": ["notes"], "Prep Steps": ["title", "expected_minutes", "checkpoint_required", "notes"] } as Record<string, string[]>)[name] ?? [],
      );
    }
    const tax = contractSheet("Variants").columns.find((column) => column.key === "price_tax_basis")!;
    expect(tax.values).toEqual(["inclusive", "exclusive", "unconfirmed"]);
    expect(tax.mapping).toBe("catalogue_variants.price_tax_basis");
  });

  it("adds the assignment policy columns after sort_order, maps them to the schema and keeps free_options_count deferred", () => {
    const sheet = contractSheet("Product Modifiers");
    expect(sheet.columns.map((column) => column.key)).toEqual([
      "product_modifier_key",
      "qos_product_modifier_id",
      "action",
      "product_key",
      "modifier_group_key",
      "sort_order",
      "min_selections",
      "max_selections",
      "repeat_allowed",
      "selection_count_mode",
      "free_options_count",
      "expected_revision",
      "clear_fields",
    ]);
    const column = (key: string) => sheet.columns.find((candidate) => candidate.key === key)!;
    for (const key of ["min_selections", "max_selections", "repeat_allowed", "selection_count_mode"]) {
      expect(column(key).mapping, key).toBe(`catalogue_product_modifier_groups.${key}`);
      expect(column(key).required, key).toBe(false);
      expect(isDeferredField(column(key)), key).toBe(false);
    }
    expect(column("repeat_allowed").values).toEqual(["TRUE", "FALSE"]);
    expect(column("selection_count_mode").values).toEqual(["distinct_options", "total_quantity"]);

    const free = column("free_options_count");
    expect(free.mapping.startsWith("Proposed")).toBe(true);
    expect(free.phase).toBe("Later review");
    expect(isDeferredField(free)).toBe(true);
  });

  it("expects v1.1 columns only in v1.1 workbooks", () => {
    const sheet = contractSheet("Product Modifiers");
    const expected = (version: string) =>
      sheet.columns.filter((column) => columnExpectedInVersion(column, version)).map((column) => column.key);
    expect(expected("1.0")).not.toContain("min_selections");
    expect(expected("1.0")).toContain("free_options_count");
    expect(expected("1.1")).toEqual(sheet.columns.map((column) => column.key));
    expect(expected("1.2")).toEqual(sheet.columns.map((column) => column.key));
    expect(expected("1.3")).toEqual(sheet.columns.map((column) => column.key));
    expect(expected("1.4")).toEqual(sheet.columns.map((column) => column.key));
  });

  it("expects the v1.3 selling-attribute columns only in v1.3 workbooks", () => {
    for (const [sheetName, keys] of [
      ["Products", ["preparation_time_minutes", "walking_time_minutes", "high_salt", "is_stock_product"]],
      ["Variants", ["selling_quantity_basis", "price_unit", "price_unit_quantity"]],
      ["Modifier Options", ["nutrition_calories"]],
    ] as const) {
      const sheet = contractSheet(sheetName);
      const expected = (version: string) =>
        sheet.columns.filter((column) => columnExpectedInVersion(column, version)).map((column) => column.key);
      for (const version of ["1.0", "1.1", "1.2"]) {
        for (const key of keys) expect(expected(version), `${sheetName}.${key}@${version}`).not.toContain(key);
      }
      expect(expected("1.4")).toEqual(sheet.columns.map((column) => column.key));
      for (const key of keys) {
        const column = sheet.columns.find((candidate) => candidate.key === key)!;
        expect(column.sinceVersion, key).toBe("1.3");
        expect(column.required, key).toBe(false);
        expect(isDeferredField(column), key).toBe(false);
        expect(expected("1.3"), `${sheetName}.${key}@1.3`).toContain(key);
      }
    }
  });

  it("expects the v1.4 cost columns only in v1.4 workbooks", () => {
    for (const sheetName of ["Variants", "Modifier Options"] as const) {
      const sheet = contractSheet(sheetName);
      const keys = [
        "cost_method",
        "reference_cost_amount",
        "cost_currency",
        "cost_unit",
        "cost_tax_basis",
        "cost_effective_date",
        "cost_source",
        "cost_source_reference",
      ];
      const expected = (version: string) =>
        sheet.columns.filter((column) => columnExpectedInVersion(column, version)).map((column) => column.key);
      for (const version of ["1.0", "1.1", "1.2", "1.3"]) {
        for (const key of keys) expect(expected(version), `${sheetName}.${key}@${version}`).not.toContain(key);
      }
      expect(expected("1.4")).toEqual(sheet.columns.map((column) => column.key));
      for (const key of keys) {
        const column = sheet.columns.find((candidate) => candidate.key === key)!;
        expect(column.sinceVersion, key).toBe("1.4");
        expect(column.required, key).toBe(false);
        expect(isDeferredField(column), key).toBe(false);
      }
    }
  });

  it("expects the v1.2 channel sheets only in v1.2 workbooks", () => {
    const expected = (version: string) =>
      WORKBOOK_CONTRACT.sheets.filter((sheet) => sheetExpectedInVersion(sheet, version)).map((sheet) => sheet.name);
    const packSheets = WORKBOOK_CONTRACT.sheets.filter((sheet) => !sheet.sinceVersion).map((sheet) => sheet.name);
    expect(expected("1.0")).toEqual(packSheets);
    expect(expected("1.1")).toEqual(packSheets);
    expect(expected("1.2")).toEqual(WORKBOOK_CONTRACT.sheets.map((sheet) => sheet.name));
    expect(expected("1.3")).toEqual(WORKBOOK_CONTRACT.sheets.map((sheet) => sheet.name));
    expect(expected("1.4")).toEqual(WORKBOOK_CONTRACT.sheets.map((sheet) => sheet.name));
    for (const name of CHANNEL_SHEETS) {
      expect(expected("1.1"), name).not.toContain(name);
      expect(expected("1.2"), name).toContain(name);
    }
  });

  it("places the channel sheets after Branch Prices and Modifier Options", () => {
    const names = WORKBOOK_CONTRACT.sheets.map((sheet) => sheet.name);
    expect(names.slice(names.indexOf("Branch Prices"), names.indexOf("Branch Prices") + 3)).toEqual([
      "Branch Prices",
      "Sales Channels",
      "Variant Channel Prices",
    ]);
    expect(names[names.indexOf("Modifier Options") + 1]).toBe("Modifier Option Channel Prices");
  });

  it("classifies the 31 sheets: 25 supported, 3 deferred, 2 rejected, 1 current-profile tab", () => {
    const bySupport = (support: string) =>
      WORKBOOK_CONTRACT.sheets.filter((sheet) => sheetSupport(sheet.name) === support).map((sheet) => sheet.name);
    expect(bySupport("supported")).toEqual([...SUPPORTED_ENTITY_SHEETS]);
    expect(bySupport("supported")).toHaveLength(25);
    expect(bySupport("deferred")).toEqual([
      "Prep Targets",
      "Opening Stock",
      "External Mappings",
    ]);
    expect(bySupport("rejected")).toEqual(["Future Combos", "Combo Components"]);
    expect(bySupport("separate_profile")).toEqual(["Current Import"]);
  });

  it("keeps the legacy limits unchanged and the expanded cell limit equal to them", () => {
    expect(IMPORT_LIMITS).toEqual({ maxFileBytes: 2 * 1024 * 1024, maxRows: 500, maxCellLength: 2000, maxColumns: 32 });
    expect(WORKBOOK_LIMITS.maxCellLength).toBe(IMPORT_LIMITS.maxCellLength);
  });
});

describe("blank 34-sheet template", () => {
  it("is a real XLSX with the contract's sheets, tables, header rows and columns", async () => {
    const bytes = await buildBlankWorkbookTemplate();
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");

    const pkg = readXlsxPackage(bytes, WORKBOOK_LIMITS.ooxml);
    expect(pkg.sheets.map((sheet) => sheet.name)).toEqual(WORKBOOK_SHEET_ORDER);
    expect(pkg.sheets).toHaveLength(34);

    const tables = Object.fromEntries(pkg.sheets.flatMap((sheet) => sheet.tables.map((table) => [table.name, table])));
    expect(Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.ref]))).toEqual(PACK_TABLE_REFS);

    for (const sheet of WORKBOOK_CONTRACT.sheets) {
      const table = tables[tableNameForSheet(sheet.name)]!;
      expect(table.columnNames, sheet.name).toEqual(tableColumnKeys(sheet));
      const owner = pkg.sheets.find((candidate) => candidate.tables.includes(table))!;
      expect(owner.name).toBe(sheet.name);
    }
    expect(tables.QOS_Workbook_Context!.columnNames).toEqual(["field", "value", "rule"]);
  });

  it("writes no formulas and no business rows, and leaves tenant context blank", async () => {
    const pkg = readXlsxPackage(await buildBlankWorkbookTemplate(), WORKBOOK_LIMITS.ooxml);
    const formulas = pkg.sheets.flatMap((sheet) => [...sheet.cells.values()].filter((cell) => cell.formula));
    expect(formulas).toEqual([]);

    for (const sheet of pkg.sheets) {
      for (const table of sheet.tables) {
        if (table.name === "QOS_Workbook_Context" || table.name === "QOS_Field_Guide") continue;
        const dataCells = [...sheet.cells.entries()].filter(([key]) => {
          const [row, column] = key.split(":").map(Number) as [number, number];
          return row > table.range.startRow && row <= table.range.endRow && column <= table.range.endColumn;
        });
        expect(dataCells, table.name).toEqual([]);
      }
    }

    const startHere = pkg.sheets[0]!;
    const context = new Map<string, string>();
    for (let row = 52; row <= 61; row += 1) {
      context.set(startHere.cells.get(`${row}:1`)!.text, startHere.cells.get(`${row}:2`)?.text ?? "");
    }
    expect(Object.fromEntries(context)).toEqual(
      Object.fromEntries(WORKBOOK_CONTRACT.context.map((entry) => [entry.field, entry.value])),
    );
    for (const field of ["tenant_public_id", "brand_public_id", "source_namespace", "export_revision", "exported_at"]) {
      expect(context.get(field), field).toBe("");
    }
  });

  it("opens in exceljs with the field guide, import rules, text formats and dropdowns", async () => {
    const workbook = await loadWorkbook(await buildBlankWorkbookTemplate());

    expect(workbook.getWorksheet("Field Guide")!.getTable("QOS_Field_Guide")).toBeDefined();
    const guide = workbook.getWorksheet("Field Guide")!;
    expect(guide.getRow(7).values).toEqual([
      undefined,
      "Current Import",
      "source_id",
      WORKBOOK_CONTRACT.sheets[0]!.columns[0]!.description,
      "text",
      "Create",
      "Existing",
      "Supported flat profile",
      "CatalogueImportColumnMapping.sourceId",
      "",
    ]);

    const rules = workbook.getWorksheet("Import Rules")!;
    expect(rules.getCell("A7").value).toBe(WORKBOOK_CONTRACT.rules[0]![0]);
    expect(rules.getCell(`B${6 + WORKBOOK_CONTRACT.rules.length}`).value).toBe(WORKBOOK_CONTRACT.rules.at(-1)![1]);

    const products = workbook.getWorksheet("Products")!;
    expect(products.getCell("I7").numFmt).toBe("@"); // sku
    expect(products.getCell("J206").numFmt).toBe("@"); // barcode, last reserved row
    expect(products.getCell("C7").dataValidation).toMatchObject({
      type: "list",
      formulae: ['"create,update,archive,skip"'],
    });
    expect(workbook.getWorksheet("Branches")!.getCell("G26").dataValidation).toMatchObject({
      formulae: ['"active,suspended"'],
    });
  });
});
