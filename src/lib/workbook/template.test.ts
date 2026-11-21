import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS } from "@/lib/catalogue/catalogue-import-parser";
import {
  sheetSupport,
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

const CONTRACT_SHA256 = "d36471c769658805813032b252e4654c1160177c8ee4a3dbd4a1b7334388520c";

/* Table ranges of the pack's reference workbook, read from its bytes. The
   generated template must reproduce them from the contract alone. */
const PACK_TABLE_REFS: Record<string, string> = {
  QOS_Workbook_Context: "A48:C58",
  QOS_Current_Import: "A1:G501",
  QOS_Branches: "A6:J26",
  QOS_Categories: "A6:K106",
  QOS_Products: "A6:P206",
  QOS_Product_Categories: "A6:I206",
  QOS_Variants: "A6:R206",
  QOS_Branch_Prices: "A6:K106",
  QOS_Modifier_Groups: "A6:L106",
  QOS_Modifier_Options: "A6:P206",
  QOS_Product_Modifiers: "A6:J206",
  QOS_Menus: "A6:L56",
  QOS_Menu_Branches: "A6:H106",
  QOS_Menu_Sections: "A6:L106",
  QOS_Menu_Items: "A6:J206",
  QOS_Units: "A6:J106",
  QOS_Suppliers: "A6:M106",
  QOS_Warehouses: "A6:J106",
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
  QOS_Field_Guide: "A6:I322",
};

describe("workbook contract", () => {
  it("is the pack's contract file, byte for byte", () => {
    const bytes = readFileSync(path.join(process.cwd(), "src/lib/workbook/qos-workbook-contract.v1.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(CONTRACT_SHA256);
    expect(WORKBOOK_CONTRACT.sheets).toHaveLength(28);
    expect(WORKBOOK_CONTRACT.sheets.flatMap((sheet) => sheet.columns)).toHaveLength(316);
  });

  it("classifies the 28 sheets: 13 supported, 12 deferred, 2 rejected, 1 current-profile tab", () => {
    const bySupport = (support: string) =>
      WORKBOOK_CONTRACT.sheets.filter((sheet) => sheetSupport(sheet.name) === support).map((sheet) => sheet.name);
    expect(bySupport("supported")).toEqual([...SUPPORTED_ENTITY_SHEETS]);
    expect(bySupport("deferred")).toEqual([
      "Units",
      "Suppliers",
      "Warehouses",
      "Inventory Categories",
      "Ingredients",
      "Recipes",
      "Recipe Lines",
      "Prep Steps",
      "Modifier Effects",
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

describe("blank 31-sheet template", () => {
  it("is a real XLSX with the contract's sheets, tables, header rows and columns", async () => {
    const bytes = await buildBlankWorkbookTemplate();
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");

    const pkg = readXlsxPackage(bytes, WORKBOOK_LIMITS.ooxml);
    expect(pkg.sheets.map((sheet) => sheet.name)).toEqual(WORKBOOK_SHEET_ORDER);
    expect(pkg.sheets).toHaveLength(31);

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
    for (let row = 49; row <= 58; row += 1) {
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
