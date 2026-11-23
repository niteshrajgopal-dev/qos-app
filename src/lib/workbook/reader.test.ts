import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildCatalogueImportSampleXlsx, CATALOGUE_IMPORT_SAMPLE_CSV } from "@/lib/catalogue/catalogue-import-sample";
import { parseSpreadsheetUpload } from "@/lib/catalogue/catalogue-import-parser";
import { columnExpectedInVersion, contractSheet, tableColumnKeys, WORKBOOK_CONTRACT } from "@/lib/workbook/contract";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { buildFoodicsMenuFixture } from "@/lib/workbook/foodics-menu/fixture";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import {
  parseWorkbookUpload,
  type ExtendedWorkbookParseResult,
  type LegacyWorkbookParseResult,
  type WorkbookParseResult,
} from "@/lib/workbook/reader";
import { buildBlankWorkbookTemplate } from "@/lib/workbook/template";
import { fillSheet, loadWorkbook, saveWorkbook, setManifestValue, writeTestZip } from "@/lib/workbook/test-support";

const PACK_TEMPLATE =
  "/workspace/qos-phase2/extracted/QOS_Phase2_Grok_Implementation_Pack/requirements/QOS_Menu_and_Operations_Template.xlsx";

let blankTemplate: Promise<Buffer> | null = null;

/** One generated template per file; every test edits its own loaded copy. */
function template() {
  blankTemplate ??= buildBlankWorkbookTemplate();
  return blankTemplate;
}

function extended(result: WorkbookParseResult): ExtendedWorkbookParseResult {
  expect(result.profile).toBe("qos_extended_v1");
  return result as ExtendedWorkbookParseResult;
}

function sheet(result: ExtendedWorkbookParseResult, name: string) {
  const found = result.sheets.find((entry) => entry.sheet === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

async function parseError(fileName: string, bytes: Buffer) {
  try {
    await parseWorkbookUpload({ fileName, bytes });
  } catch (error) {
    if (error instanceof WorkbookParseError) return error;
    throw error;
  }
  throw new Error("expected a WorkbookParseError");
}

async function filledWorkbook(edit?: (workbook: Awaited<ReturnType<typeof loadWorkbook>>) => void) {
  const workbook = await loadWorkbook(await template());
  fillSheet(workbook, "Branches", 6, [
    { branch_key: "hbz", action: "create", name: "HBZ Stadium", timezone: "Asia/Dubai", slug: "hbz-stadium", status: "active" },
  ]);
  fillSheet(workbook, "Products", 6, [
    {
      product_key: "flat-white",
      action: "create",
      internal_name: "flat-white",
      display_name_en: "Flat White",
      display_name_ar: "فلات وايت",
      sku: "000123",
      barcode: "0062911234567",
      status: "draft",
    },
    {
      product_key: "espresso",
      action: "create",
      internal_name: "espresso",
      display_name_en: "Espresso",
      display_name_ar: "إسبريسو",
      status: "draft",
    },
  ]);
  fillSheet(workbook, "Variants", 6, [
    {
      variant_key: "flat-white-regular",
      action: "create",
      product_key: "flat-white",
      is_default: "TRUE",
      sort_order: "0",
      amount_minor: "1800",
      currency: "AED",
      status: "active",
    },
  ]);
  edit?.(workbook);
  return saveWorkbook(workbook);
}

describe("parseWorkbookUpload: expanded profile", () => {
  it("reads the generated blank template as the expanded profile with no business rows and no tenant context", async () => {
    const result = extended(await parseWorkbookUpload({ fileName: "template.xlsx", bytes: await template() }));

    expect(result.manifest).toEqual({
      profile: "qos-extended-v1-proposed",
      template_version: "1.4",
      prepared_on: "2026-11-21",
      tenant_public_id: "",
      brand_public_id: "",
      source_namespace: "",
      export_revision: "",
      exported_at: "",
      pilot_currency: "AED",
      business_timezone: "Asia/Dubai",
    });
    expect(result.isExport).toBe(false);
    expect(result.sheets.map((entry) => entry.sheet)).toEqual(WORKBOOK_CONTRACT.sheets.map((entry) => entry.name));
    expect(result.sheets.every((entry) => entry.present && entry.rowCount === 0)).toBe(true);
    expect(result.guidanceSheets).toEqual(["Start Here", "Field Guide", "Import Rules"]);
    expect(result.summary).toMatchObject({
      supported: { sheets: 16, rows: 0 },
      deferred: { sheets: 12, rows: 0 },
      rejected: { sheets: 2, rows: 0 },
      separate_profile: { sheets: 1, rows: 0 },
      errors: 0,
      warnings: 0,
    });
  });

  it("reads every named entity table, not just the first worksheet, and keeps identifiers as text", async () => {
    const result = extended(await parseWorkbookUpload({ fileName: "filled.xlsx", bytes: await filledWorkbook() }));

    expect(sheet(result, "Branches").rows).toEqual([
      {
        row: 7,
        values: {
          branch_key: "hbz",
          qos_location_id: "",
          action: "create",
          name: "HBZ Stadium",
          timezone: "Asia/Dubai",
          slug: "hbz-stadium",
          status: "active",
          expected_revision: "",
          clear_fields: "",
        },
      },
    ]);
    const products = sheet(result, "Products");
    expect(products.rows.map((row) => row.row)).toEqual([7, 8]);
    expect(products.rows[0]!.values).toMatchObject({
      product_key: "flat-white",
      display_name_ar: "فلات وايت",
      sku: "000123",
      barcode: "0062911234567",
    });
    expect(products.columns).toEqual(tableColumnKeys(contractSheet("Products")));
    expect(sheet(result, "Variants").rows[0]!.values).toMatchObject({ product_key: "flat-white", amount_minor: "1800", is_default: "TRUE" });
    expect(result.summary.supported.rows).toBe(4);
    expect(result.summary.errors).toBe(0);
  });

  it("changes its parsed records when the file contents change, whatever the file is called", async () => {
    const before = extended(await parseWorkbookUpload({ fileName: "same-name.xlsx", bytes: await filledWorkbook() }));
    const after = extended(
      await parseWorkbookUpload({
        fileName: "same-name.xlsx",
        bytes: await filledWorkbook((workbook) => {
          fillSheet(workbook, "Products", 6, [{ display_name_en: "Flat White Large", sku: "000124" }]);
        }),
      }),
    );

    expect(sheet(before, "Products").rows[0]!.values.display_name_en).toBe("Flat White");
    expect(sheet(after, "Products").rows[0]!.values).toMatchObject({ display_name_en: "Flat White Large", sku: "000124" });
    expect(after.fileFingerprint).not.toBe(before.fileFingerprint);

    // Renaming the file alone changes nothing in the records.
    const renamed = extended(await parseWorkbookUpload({ fileName: "demo-rows.xlsx", bytes: await filledWorkbook() }));
    expect(renamed.sheets).toEqual(before.sheets);
  });

  it("never evaluates or trusts formulas, and ignores row_check helpers", async () => {
    const bytes = await filledWorkbook((workbook) => {
      fillSheet(workbook, "Products", 6, [
        {
          internal_name: { formula: 'UPPER("flat-white")', result: "FLAT-WHITE" },
          row_check: { formula: '"Ready for QOS review"', result: "Ready for QOS review" },
        },
      ]);
    });
    const products = sheet(extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes })), "Products");

    expect(products.rows[0]!.values.internal_name).toBe("");
    expect(products.rows[0]!.values).not.toHaveProperty("row_check");
    expect(products.issues).toEqual([
      { sheet: "Products", severity: "error", code: "formula_ignored", row: 7, column: "internal_name", params: { cell: "D7" } },
    ]);
  });

  it("warns when an identifier was stored as a number, because leading zeros may already be lost", async () => {
    const bytes = await filledWorkbook((workbook) => {
      fillSheet(workbook, "Products", 6, [{ barcode: 62911234567 }]);
    });
    const products = sheet(extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes })), "Products");

    expect(products.rows[0]!.values.barcode).toBe("62911234567");
    expect(products.issues).toContainEqual({
      sheet: "Products",
      severity: "warning",
      code: "identifier_number",
      row: 7,
      column: "barcode",
      params: { cell: "J7" },
    });
  });

  it("classifies deferred, rejected and separate-profile sheets and never reports them as importable", async () => {
    const bytes = await filledWorkbook((workbook) => {
      fillSheet(workbook, "Units", 6, [{ unit_key: "g", action: "create", name: "gram", quantity_kind: "mass", decimal_places: "0", active: "TRUE" }]);
      fillSheet(workbook, "Opening Stock", 6, [{ opening_row_key: "o1", action: "create", quantity_storage_units: "4" }]);
      fillSheet(workbook, "Future Combos", 6, [{ combo_key: "c1", action: "create", name: "Breakfast combo" }]);
      fillSheet(workbook, "Current Import", 1, [{ source_id: "s1", internal_name: "x", display_name_en: "X", display_name_ar: "س", amount_minor: "100", currency: "AED" }]);
      fillSheet(workbook, "Variants", 6, [{ price_tax_basis: "GROSS" }]);
      fillSheet(workbook, "Product Modifiers", 6, [{ product_modifier_key: "pm", action: "create", product_key: "flat-white", modifier_group_key: "milk", sort_order: "0", free_options_count: "1" }]);
    });
    const result = extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes }));

    expect(sheet(result, "Units")).toMatchObject({ support: "deferred", rowCount: 1 });
    expect(sheet(result, "Units").issues).toEqual([{ sheet: "Units", severity: "warning", code: "deferred_sheet", params: { count: 1 } }]);
    expect(sheet(result, "Opening Stock").issues).toEqual([
      { sheet: "Opening Stock", severity: "warning", code: "opening_stock_draft", params: { count: 1 } },
    ]);
    expect(sheet(result, "Future Combos")).toMatchObject({ support: "rejected", rowCount: 1 });
    expect(sheet(result, "Future Combos").issues[0]).toMatchObject({ code: "rejected_sheet" });
    expect(sheet(result, "Current Import")).toMatchObject({ support: "separate_profile", rowCount: 1, rows: [] });
    expect(sheet(result, "Current Import").issues[0]).toMatchObject({ code: "current_import_tab" });
    // QOS-215 persists the selling tax basis, so it is no longer a deferred field.
    expect(sheet(result, "Variants").issues).not.toContainEqual(
      expect.objectContaining({ code: "deferred_field", column: "price_tax_basis" }),
    );
    expect(sheet(result, "Product Modifiers").issues).toContainEqual(
      expect.objectContaining({ code: "deferred_field", column: "free_options_count" }),
    );
    expect(result.summary).toMatchObject({
      supported: { rows: 5 },
      deferred: { rows: 2 },
      rejected: { rows: 1 },
      separate_profile: { rows: 1 },
    });
  });

  it("still reads a v1.0 workbook without the v1.1 Product Modifiers columns and reports no missing columns", async () => {
    const workbook = await loadWorkbook(await filledWorkbook());
    setManifestValue(workbook, "template_version", "1.0");
    const v10Columns = contractSheet("Product Modifiers")
      .columns.filter((column) => !column.since)
      .map((column) => column.key);
    const worksheet = workbook.getWorksheet("Product Modifiers")!;
    worksheet.removeTable("QOS_Product_Modifiers");
    for (let column = 1; column <= 20; column += 1) worksheet.getCell(6, column).value = null;
    worksheet.addTable({
      name: "QOS_Product_Modifiers",
      ref: "A6",
      columns: [...v10Columns, "row_check"].map((name) => ({ name })),
      rows: [v10Columns.map((key) => ({ product_modifier_key: "pm", action: "create", product_key: "flat-white", modifier_group_key: "milk", sort_order: "0" })[key] ?? null).concat([null])],
    });

    const result = extended(await parseWorkbookUpload({ fileName: "v10.xlsx", bytes: await saveWorkbook(workbook) }));
    expect(result.templateVersion).toBe("1.0");
    const productModifiers = sheet(result, "Product Modifiers");
    expect(productModifiers.issues).toEqual([]);
    expect(productModifiers.rows).toEqual([
      {
        row: 7,
        values: {
          product_modifier_key: "pm",
          qos_product_modifier_id: "",
          action: "create",
          product_key: "flat-white",
          modifier_group_key: "milk",
          sort_order: "0",
          free_options_count: "",
          expected_revision: "",
          clear_fields: "",
        },
      },
    ]);

    // The same table in a file that claims 1.1 is missing optional columns.
    setManifestValue(workbook, "template_version", "1.1");
    const claimed = extended(await parseWorkbookUpload({ fileName: "v11.xlsx", bytes: await saveWorkbook(workbook) }));
    expect(sheet(claimed, "Product Modifiers").issues).toEqual([
      {
        sheet: "Product Modifiers",
        severity: "warning",
        code: "missing_columns",
        params: { columns: "min_selections, max_selections, repeat_allowed, selection_count_mode" },
      },
    ]);
  });

  it("reads assignment policy values and holds only the row with an ambiguous counting mode for review", async () => {
    const bytes = await filledWorkbook((workbook) => {
      fillSheet(workbook, "Product Modifiers", 6, [
        { product_modifier_key: "pm-burger", action: "create", product_key: "flat-white", modifier_group_key: "extras", sort_order: "0", min_selections: "1", max_selections: "1", repeat_allowed: "FALSE", selection_count_mode: "total_quantity" },
        { product_modifier_key: "pm-fries", action: "create", product_key: "espresso", modifier_group_key: "extras", sort_order: "0", max_selections: "3", repeat_allowed: "TRUE" },
        { product_modifier_key: "pm-foodics", action: "create", product_key: "espresso", modifier_group_key: "sauces", sort_order: "1", selection_count_mode: "Total" },
      ]);
    });
    const productModifiers = sheet(extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes })), "Product Modifiers");

    expect(productModifiers.rows.map((row) => [row.values.min_selections, row.values.max_selections, row.values.repeat_allowed, row.values.selection_count_mode])).toEqual([
      ["1", "1", "FALSE", "total_quantity"],
      ["", "3", "TRUE", ""],
      ["", "", "", "Total"],
    ]);
    expect(productModifiers.issues).toEqual([
      {
        sheet: "Product Modifiers",
        severity: "error",
        code: "ambiguous_selection_count_mode",
        row: 9,
        column: "selection_count_mode",
        params: { cell: "J9", value: "Total" },
      },
    ]);
  });

  it("does not treat guidance sheets, context rows or text typed below a table as business rows", async () => {
    const bytes = await filledWorkbook((workbook) => {
      workbook.getWorksheet("Start Here")!.getCell("A60").value = "product_key";
      workbook.getWorksheet("Field Guide")!.getCell("B400").value = "flat-white";
      workbook.getWorksheet("Branches")!.getCell("A40").value = "typed-below-table";
    });
    const result = extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes }));

    expect(sheet(result, "Branches").rows).toHaveLength(1);
    expect(sheet(result, "Branches").issues).toEqual([
      { sheet: "Branches", severity: "warning", code: "rows_outside_table", params: { cells: 1, lastRow: 26 } },
    ]);
    expect(result.summary.supported.rows).toBe(4);
  });

  it("flags a manifest that names another tenant or brand", async () => {
    const bytes = await filledWorkbook((workbook) => {
      setManifestValue(workbook, "tenant_public_id", "ten_other");
      setManifestValue(workbook, "brand_public_id", "brand_other");
    });
    const result = extended(
      await parseWorkbookUpload({ fileName: "f.xlsx", bytes }, { tenantPublicId: "ten_quotes", brandPublicIds: ["brand_quotes"] }),
    );
    expect(result.issues).toEqual([
      { severity: "error", code: "tenant_mismatch", sheet: "QOS_Workbook_Context", params: { found: "ten_other", expected: "ten_quotes" } },
      { severity: "error", code: "brand_mismatch", sheet: "QOS_Workbook_Context", params: { found: "brand_other" } },
    ]);
  });

  it("returns recoverable errors for an unknown profile or template version", async () => {
    const wrongProfile = await filledWorkbook((workbook) => setManifestValue(workbook, "profile", "qos-extended-v2"));
    expect((await parseError("f.xlsx", wrongProfile)).code).toBe("unknown_profile");

    const wrongVersion = await filledWorkbook((workbook) => setManifestValue(workbook, "template_version", "2.0"));
    const error = await parseError("f.xlsx", wrongVersion);
    expect(error.code).toBe("unsupported_version");
    expect(error.params).toEqual({ version: "2.0", expected: "1.0, 1.1, 1.2, 1.3, 1.4" });

    const calculated = await filledWorkbook((workbook) =>
      setManifestValue(workbook, "template_version", { formula: '"1.0"', result: "1.0" }),
    );
    expect((await parseError("f.xlsx", calculated)).code).toBe("manifest_invalid");
  });

  it("reads 1.0 to 1.3 files without warning about the 1.4 cost columns they never had", async () => {
    const costColumns = (sheet: "Variants" | "Modifier Options") =>
      contractSheet(sheet).columns.filter((column) => column.sinceVersion === "1.4");
    expect(costColumns("Variants").map((column) => column.key)).toEqual([
      "cost_method",
      "reference_cost_amount",
      "cost_currency",
      "cost_unit",
      "cost_tax_basis",
      "cost_effective_date",
      "cost_source",
      "cost_source_reference",
    ]);
    expect(costColumns("Modifier Options")).toHaveLength(8);
    expect(contractSheet("Variants").columns.map((column) => column.key)).toContain("price_tax_basis");

    const v10Values: Record<string, string> = {
      variant_key: "latte-regular",
      action: "create",
      product_key: "latte",
      price_tax_basis: "GROSS",
      tax_rate_basis_points: "500",
    };
    const columnsFor = (sheet: "Variants" | "Modifier Options", version: string) =>
      contractSheet(sheet).columns.filter((column) => columnExpectedInVersion(column, version));
    const writeVersionTables = (workbook: Awaited<ReturnType<typeof loadWorkbook>>, version: string) => {
      const variantColumns = columnsFor("Variants", version);
      const optionColumns = columnsFor("Modifier Options", version);
      const variants = workbook.getWorksheet("Variants")!;
      variants.removeTable("QOS_Variants");
      variants.addTable({
        name: "QOS_Variants",
        ref: "A6",
        columns: [...variantColumns.map((column) => ({ name: column.key })), { name: "row_check" }],
        rows: [[...variantColumns.map((column) => v10Values[column.key] ?? null), null]],
      });
      const options = workbook.getWorksheet("Modifier Options")!;
      options.removeTable("QOS_Modifier_Options");
      options.addTable({
        name: "QOS_Modifier_Options",
        ref: "A6",
        columns: [...optionColumns.map((column) => ({ name: column.key })), { name: "row_check" }],
        rows: [[...optionColumns.map((column) => (column.key === "modifier_option_key" ? "oat" : null)), null]],
      });
    };

    for (const version of ["1.0", 1, "1.1", "1.2", "1.3"] as const) {
      const normalized = version === 1 ? "1.0" : version;
      const workbook = await loadWorkbook(await template());
      writeVersionTables(workbook, normalized);
      setManifestValue(workbook, "template_version", version);
      const result = extended(await parseWorkbookUpload({ fileName: "old.xlsx", bytes: await saveWorkbook(workbook) }));
      expect(result.templateVersion, String(version)).toBe(version === 1 ? "1.0" : version);
      for (const name of ["Variants", "Modifier Options"]) {
        expect(sheet(result, name).issues.filter((issue) => issue.code === "missing_columns"), `${name} ${version}`).toEqual([]);
      }
      expect(sheet(result, "Variants").rows[0]?.values).toMatchObject({ price_tax_basis: "GROSS", tax_rate_basis_points: "500" });
      expect(sheet(result, "Variants").rows[0]?.values).not.toHaveProperty("cost_method");
    }

    // A file that claims 1.4 is expected to carry them, so their absence is reported.
    const workbook = await loadWorkbook(await template());
    writeVersionTables(workbook, "1.3");
    const result = extended(await parseWorkbookUpload({ fileName: "new.xlsx", bytes: await saveWorkbook(workbook) }));
    expect(sheet(result, "Variants").issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "missing_columns", params: { columns: expect.stringContaining("cost_method") } }),
    );
  });

  it("reads the 1.4 cost columns on Variants and Modifier Options as written", async () => {
    const bytes = await filledWorkbook((workbook) => {
      fillSheet(workbook, "Variants", 6, [
        {
          price_tax_basis: "inclusive",
          tax_rate_basis_points: "0",
          cost_method: "manual",
          reference_cost_amount: "1.234567",
          cost_currency: "AED",
          cost_unit: "each",
          cost_tax_basis: "NET",
          cost_effective_date: "2026-11-22",
        },
      ]);
      fillSheet(workbook, "Modifier Options", 6, [
        { modifier_option_key: "oat", action: "create", cost_method: "recipe_derived" },
      ]);
    });
    const result = extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes }));
    expect(sheet(result, "Variants").rows[0]?.values).toMatchObject({
      price_tax_basis: "inclusive",
      tax_rate_basis_points: "0",
      cost_method: "manual",
      reference_cost_amount: "1.234567",
      cost_tax_basis: "NET",
    });
    expect(sheet(result, "Modifier Options").rows[0]?.values).toMatchObject({ cost_method: "recipe_derived", reference_cost_amount: "" });
    for (const name of ["Variants", "Modifier Options"]) {
      expect(sheet(result, name).issues.filter((issue) => issue.code === "deferred_field" || issue.code === "missing_columns")).toEqual([]);
    }
  });

  it("refuses QOS entity tables without the manifest instead of guessing the context", async () => {
    const workbook = await loadWorkbook(await filledWorkbook());
    const startHere = workbook.getWorksheet("Start Here")!;
    startHere.removeTable("QOS_Workbook_Context");
    expect((await parseError("f.xlsx", await saveWorkbook(workbook))).code).toBe("manifest_missing");
  });

  it("reports a table moved off the documented header row and missing required columns", async () => {
    const workbook = await loadWorkbook(await template());
    const products = workbook.getWorksheet("Products")!;
    products.removeTable("QOS_Products");
    products.addTable({
      name: "QOS_Products",
      ref: "A2",
      columns: [{ name: "product_key" }, { name: "action" }],
      rows: [["p1", "create"]],
    });
    const categories = workbook.getWorksheet("Categories")!;
    categories.removeTable("QOS_Categories");
    categories.addTable({
      name: "QOS_Categories",
      ref: "A6",
      columns: [{ name: "category_key" }, { name: "action" }, { name: "colour" }],
      rows: [["c1", "create", "red"]],
    });
    const result = extended(await parseWorkbookUpload({ fileName: "f.xlsx", bytes: await saveWorkbook(workbook) }));

    expect(sheet(result, "Products").issues).toEqual([
      { sheet: "Products", severity: "error", code: "table_position", params: { expectedRow: 6, actualRow: 2, ref: "A2:B3" } },
    ]);
    expect(sheet(result, "Products").rows).toEqual([]);
    expect(sheet(result, "Categories").issues[0]).toMatchObject({
      severity: "error",
      code: "missing_columns",
      params: { columns: "internal_name, display_name_en, display_name_ar, sort_order, status" },
    });
  });

  it("reads workbooks written with prefixed namespaces, byte-order marks and absolute part targets", async () => {
    const bom = "﻿";
    const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const rel = (id: string, type: string, target: string) =>
      `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" Id="${id}" />`;
    const rels = (body: string) =>
      `${bom}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
    const str = (ref: string, value: string) => `<x:c r="${ref}" t="str"><x:v>${value}</x:v></x:c>`;
    const productHeaders = contractSheet("Products").columns.map((column) => column.key);
    const headerCells = productHeaders.map((key, index) => str(`${String.fromCharCode(65 + index)}6`, key)).join("");
    const contextRows = WORKBOOK_CONTRACT.context
      .map((entry, index) => `<x:row r="${2 + index}">${str(`A${2 + index}`, entry.field)}${entry.value ? str(`B${2 + index}`, entry.value) : ""}</x:row>`)
      .join("");
    const lastColumn = String.fromCharCode(64 + productHeaders.length);

    const bytes = writeTestZip([
      { name: "[Content_Types].xml", data: `${bom}<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
      { name: "_rels/.rels", data: rels(rel("R1", "officeDocument", "/xl/workbook.xml")) },
      {
        name: "xl/workbook.xml",
        data: `${bom}<?xml version="1.0" encoding="utf-8"?><x:workbook ${ns}><x:sheets><x:sheet name="Start Here" sheetId="1" r:id="Ra" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /><x:sheet name="Products" sheetId="2" r:id="Rb" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>`,
      },
      { name: "xl/_rels/workbook.xml.rels", data: rels(rel("Ra", "worksheet", "/xl/worksheets/sheet1.xml") + rel("Rb", "worksheet", "/xl/worksheets/sheet2.xml")) },
      {
        name: "xl/worksheets/sheet1.xml",
        data: `${bom}<?xml version="1.0" encoding="utf-8"?><x:worksheet ${ns}><x:sheetData><x:row r="1">${str("A1", "field")}${str("B1", "value")}${str("C1", "rule")}</x:row>${contextRows}</x:sheetData></x:worksheet>`,
      },
      { name: "xl/worksheets/_rels/sheet1.xml.rels", data: rels(rel("Rt1", "table", "/xl/tables/table1.xml")) },
      {
        name: "xl/tables/table1.xml",
        data: `${bom}<?xml version="1.0" encoding="utf-8"?><x:table id="1" name="QOS_Workbook_Context" displayName="QOS_Workbook_Context" ref="A1:C11" ${ns}><x:tableColumns count="3"><x:tableColumn id="1" name="field" /><x:tableColumn id="2" name="value" /><x:tableColumn id="3" name="rule" /></x:tableColumns></x:table>`,
      },
      {
        name: "xl/worksheets/sheet2.xml",
        data: `${bom}<?xml version="1.0" encoding="utf-8"?><x:worksheet ${ns}><x:sheetData><x:row r="6">${headerCells}</x:row><x:row r="7">${str("A7", "flat-white")}${str("C7", "create")}<x:c r="I7" t="inlineStr"><x:is><x:t>000123</x:t></x:is></x:c><x:c r="P7" t="str"><x:f>IF(A7="","","Ready")</x:f><x:v>Ready</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
      },
      { name: "xl/worksheets/_rels/sheet2.xml.rels", data: rels(rel("Rt2", "table", "/xl/tables/table2.xml")) },
      {
        name: "xl/tables/table2.xml",
        data: `${bom}<?xml version="1.0" encoding="utf-8"?><x:table id="2" name="QOS_Products" displayName="QOS_Products" ref="A6:${lastColumn}8" ${ns}><x:tableColumns count="${productHeaders.length}">${productHeaders.map((key, index) => `<x:tableColumn id="${index + 1}" name="${key}" />`).join("")}</x:tableColumns></x:table>`,
      },
    ]);

    const result = extended(await parseWorkbookUpload({ fileName: "sdk.xlsx", bytes }));
    expect(sheet(result, "Products").rows).toEqual([
      {
        row: 7,
        values: expect.objectContaining({ product_key: "flat-white", action: "create", sku: "000123", status: "" }),
      },
    ]);
    expect(sheet(result, "Branches")).toMatchObject({ present: false, issues: [expect.objectContaining({ code: "sheet_missing", severity: "info" })] });
  });

  it.skipIf(!existsSync(PACK_TEMPLATE))("reads the pack's reference workbook bytes (local pack only, never committed)", async () => {
    const result = extended(await parseWorkbookUpload({ fileName: "pack.xlsx", bytes: readFileSync(PACK_TEMPLATE) }));
    // The pack is a 1.0 file: every 1.0 sheet is present, and the 1.2 channel sheets are simply not expected.
    expect(result.templateVersion).toBe("1.0");
    expect(result.sheets.filter((entry) => !entry.present).map((entry) => entry.sheet)).toEqual([
      "Sales Channels",
      "Variant Channel Prices",
      "Modifier Option Channel Prices",
    ]);
    expect(result.sheets.flatMap((entry) => entry.issues).filter((entry) => entry.code === "sheet_missing")).toEqual([]);
    expect(result.summary.errors).toBe(0);
    expect(result.manifest.profile).toBe("qos-extended-v1-proposed");
    // The pack file is a v1.0 workbook: neither the v1.1 policy columns nor the v1.3 selling-attribute columns are "missing".
    expect(result.templateVersion).toBe("1.0");
    expect(result.sheets.flatMap((entry) => entry.issues).filter((issue) => issue.code === "missing_columns")).toEqual([]);
  });
});

describe("parseWorkbookUpload: legacy flat profile", () => {
  it("keeps the seven-column CSV meaning and matches the existing parser", async () => {
    const bytes = Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8");
    const result = (await parseWorkbookUpload({ fileName: "sample.csv", bytes })) as LegacyWorkbookParseResult;
    const legacy = await parseSpreadsheetUpload({ fileName: "sample.csv", bytes });

    expect(result.profile).toBe("legacy_flat");
    expect(result.container).toBe("csv");
    expect(result.headers).toEqual(legacy.headers);
    expect(result.rows).toEqual(legacy.rows);
    expect(result.suggestedMapping).toMatchObject({ sourceId: "source_id", amountMinor: "amount_minor" });
  });

  it("checks the Foodics menu layout before the legacy fallback, so that layout is never read as a flat file", async () => {
    const result = await parseWorkbookUpload({ fileName: "menu.xlsx", bytes: await buildFoodicsMenuFixture({ prefillLastRow: 30 }) });
    expect(result.profile).toBe("foodics_menu_v1");
    expect(result).not.toHaveProperty("headers");
  });

  it("treats an XLSX without the manifest as the legacy first-worksheet profile", async () => {
    const bytes = await buildCatalogueImportSampleXlsx();
    const result = (await parseWorkbookUpload({ fileName: "sample.xlsx", bytes })) as LegacyWorkbookParseResult;
    expect(result).toMatchObject({ profile: "legacy_flat", container: "xlsx", rowCount: 3 });
    expect(result.rows[0]).toMatchObject({ source_id: "quotes-fw-001", amount_minor: "1800" });
  });
});

describe("parseWorkbookUpload: boundaries", () => {
  it("rejects empty, oversize and wrong-type input with recoverable errors", async () => {
    expect((await parseError("a.xlsx", Buffer.alloc(0))).code).toBe("empty_file");
    expect((await parseError("a.xlsx", Buffer.alloc(WORKBOOK_LIMITS.maxFileBytes + 1, 0x50))).code).toBe("file_too_large");
    expect((await parseError("menu.pdf", Buffer.from("%PDF-1.7"))).code).toBe("wrong_type");
    expect((await parseError("menu.xlsx", Buffer.from("%PDF-1.7 not a workbook"))).code).toBe("wrong_type");
    expect((await parseError("old.xlsx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).code).toBe("wrong_type");
    expect((await parseError("binary.csv", Buffer.from([0x41, 0x00, 0x42]))).code).toBe("wrong_type");
    expect((await parseError("renamed.csv", await template())).code).toBe("extension_mismatch");
  });

  it("rejects malformed and truncated workbooks as recoverable errors", async () => {
    const bytes = await template();
    expect((await parseError("cut.xlsx", bytes.subarray(0, bytes.length / 2))).code).toBe("malformed_workbook");
    expect((await parseError("junk.xlsx", writeTestZip([{ name: "xl/workbook.xml", data: "<workbook><sheets>" }]))).code).toBe(
      "malformed_workbook",
    );
    expect(
      (
        await parseError(
          "xxe.xlsx",
          writeTestZip([
            {
              name: "xl/workbook.xml",
              data: '<?xml version="1.0"?><!DOCTYPE w [<!ENTITY x SYSTEM "http://example.invalid/x">]><workbook>&x;</workbook>',
            },
          ]),
        )
      ).code,
    ).toBe("unsafe_workbook");
  });

  it("rejects tables and cells past the expanded-profile limits", async () => {
    const tooLong = await filledWorkbook((workbook) => {
      fillSheet(workbook, "Products", 6, [{ description_en: "x".repeat(WORKBOOK_LIMITS.maxCellLength + 1) }]);
    });
    const cellError = await parseError("f.xlsx", tooLong);
    expect(cellError.code).toBe("cell_too_long");
    expect(cellError.params).toMatchObject({ sheet: "Products", cell: "G7" });

    const workbook = await loadWorkbook(await template());
    const units = workbook.getWorksheet("Units")!;
    units.removeTable("QOS_Units");
    units.addTable({
      name: "QOS_Units",
      ref: "A6",
      columns: tableColumnKeys(contractSheet("Units")).map((name) => ({ name })),
      rows: Array.from({ length: WORKBOOK_LIMITS.maxRowsPerTable + 1 }, () => tableColumnKeys(contractSheet("Units")).map(() => "")),
    });
    expect((await parseError("f.xlsx", await saveWorkbook(workbook))).code).toBe("too_many_rows");
  });
});
