import { describe, expect, it } from "vitest";

import { WORKBOOK_CONTRACT } from "@/lib/workbook/contract";
import { SOURCE_MAP_SHEET, SOURCE_MAP_TABLE } from "@/lib/workbook/dictionary";
import { WorkbookParseError } from "@/lib/workbook/errors";
import {
  assertConvertible,
  buildConvertedWorkbook,
  convertedFileName,
  SOURCE_MAP_COLUMNS,
  sourceMapRows,
} from "@/lib/workbook/foodics-menu/convert";
import { buildFoodicsMenuFixture, FIXTURE_SHEETS, FOODICS_FIXTURE_FILE_NAME, type FoodicsFixtureOptions } from "@/lib/workbook/foodics-menu/fixture";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { cellKey, readXlsxPackage } from "@/lib/workbook/ooxml";
import {
  parseWorkbookUpload,
  type ExtendedWorkbookParseResult,
  type WorkbookParseOptions,
} from "@/lib/workbook/reader";
import { buildBlankWorkbookTemplate } from "@/lib/workbook/template";
import { openZip } from "@/lib/workbook/zip";

const OPTIONS: WorkbookParseOptions = {
  tenantCurrency: "AED",
  tenantPublicId: "ten_test",
  brandPublicIds: ["brd_one"],
  brandChoices: [{ publicId: "brd_one", name: "One" }],
};

async function parseSource(fixture: FoodicsFixtureOptions = {}, options: WorkbookParseOptions = OPTIONS) {
  const bytes = await buildFoodicsMenuFixture({ prefillLastRow: 60, ...fixture });
  const result = await parseWorkbookUpload({ fileName: FOODICS_FIXTURE_FILE_NAME, bytes }, options);
  assertConvertible(result);
  return result;
}

async function convertAndRead(source: FoodicsMenuParseResult) {
  const bytes = await buildConvertedWorkbook(source, { businessTimezone: "Asia/Dubai" });
  const parsed = await parseWorkbookUpload({ fileName: convertedFileName(source), bytes }, OPTIONS);
  expect(parsed.profile).toBe("qos_extended_v1");
  return { bytes, parsed: parsed as ExtendedWorkbookParseResult };
}

function sheetValues(result: { sheets: Array<{ sheet: string; rows: Array<{ values: Record<string, string> }> }> }, sheet: string) {
  return result.sheets.find((entry) => entry.sheet === sheet)!.rows.map((row) => row.values);
}

function allKeys(result: FoodicsMenuParseResult) {
  return result.sheets.flatMap((sheet) => {
    const keyColumn = WORKBOOK_CONTRACT.sheets.find((entry) => entry.name === sheet.sheet)!.columns[0]!.key;
    return sheet.rows.map((row) => row.values[keyColumn]);
  });
}

describe("convert a Foodics menu workbook into a QOS workbook", () => {
  it("round-trips: the converted bytes parse as the QOS profile with the same canonical rows", async () => {
    const source = await parseSource({ filled: true });
    const { parsed } = await convertAndRead(source);

    expect(parsed.isExport).toBe(false);
    expect(parsed.manifest).toMatchObject({
      profile: "qos-extended-v1-proposed",
      template_version: "1.0",
      tenant_public_id: "ten_test",
      brand_public_id: "brd_one",
      source_namespace: "foodics-menu-v1:ten_test",
      export_revision: "",
      exported_at: "",
      pilot_currency: "AED",
      business_timezone: "Asia/Dubai",
    });
    expect(parsed.manifestExtensions).toEqual({
      source_profile: "foodics_menu_v1",
      source_profile_version: "1",
      dictionary_version: "1.1",
      source_file_sha256: source.fileFingerprint,
    });

    // No errors, and no unknown sheet, table or context field: the only notes
    // are the same deferred classifications the source parse already reported.
    expect(parsed.summary.errors).toBe(0);
    expect(parsed.issues).toEqual([]);
    const notes = (result: { sheets: Array<{ issues: Array<{ code: string; sheet?: string; column?: string }> }> }) =>
      result.sheets.flatMap((sheet) => sheet.issues).map((issue) => [issue.sheet, issue.code, issue.column ?? ""]);
    expect(notes(parsed)).toEqual(notes(source));
    expect(new Set(notes(parsed).map(([, code]) => code))).toEqual(new Set(["deferred_field", "deferred_sheet"]));

    for (const sheet of source.sheets) {
      expect(sheetValues(parsed, sheet.sheet), sheet.sheet).toEqual(sheetValues(source, sheet.sheet));
    }
    // Leading zeros and Arabic text survive the workbook round trip.
    expect(sheetValues(parsed, "Products")[0]).toMatchObject({ sku: "000123", barcode: "0062911234567", display_name_ar: "فلات وايت" });
    expect(sheetValues(parsed, "Variants")[0]).toMatchObject({ amount_minor: "1250", currency: "AED", is_default: "TRUE" });
  });

  it("writes a Source Map that the QOS reader knows but never reads as business rows", async () => {
    const source = await parseSource({ filled: true });
    const { bytes, parsed } = await convertAndRead(source);
    expect(parsed.sheets.map((sheet) => sheet.sheet)).not.toContain(SOURCE_MAP_SHEET);

    const pkg = readXlsxPackage(bytes, WORKBOOK_LIMITS.ooxml);
    const sheet = pkg.sheets.find((entry) => entry.name === SOURCE_MAP_SHEET)!;
    expect(sheet.tables.map((table) => [table.name, table.range.startRow])).toEqual([[SOURCE_MAP_TABLE, 6]]);
    const header = SOURCE_MAP_COLUMNS.map((_, index) => sheet.cells.get(cellKey(6, index + 1))?.text);
    expect(header).toEqual([...SOURCE_MAP_COLUMNS]);

    const mapRows = sourceMapRows(source);
    const totalRows = source.sheets.reduce((sum, entry) => sum + entry.rowCount, 0);
    expect(mapRows.filter((row) => row.kind === "row")).toHaveLength(totalRows);
    expect(mapRows.filter((row) => row.kind === "issue")).toHaveLength(
      source.issues.length + source.sheets.reduce((sum, entry) => sum + entry.issues.length, 0),
    );
    expect(mapRows).toContainEqual({
      target_sheet: "Variants",
      target_key: "prd~flat-white~45e955ba~default",
      kind: "value",
      source_sheet: "Products",
      source_ref: "Products!K11",
      field: "price",
      value_text: "12.50",
      capability: "deferred",
    });
    expect(mapRows).toContainEqual(
      expect.objectContaining({ target_sheet: "Products", kind: "row", source_ref: "Products!D11:V11", capability: "recognized" }),
    );
    expect(mapRows).toContainEqual(
      expect.objectContaining({ kind: "value", field: "channel_price:delivery", value_text: "14.00", source_ref: "Products!N11" }),
    );
    // The first Source Map data row is written as text in the workbook.
    expect(sheet.cells.get(cellKey(7, 2))?.text).toBe(mapRows[0]!.target_key);
  });

  it("changes exactly what changed in the source: one price, one renamed product", async () => {
    const original = await parseSource({ filled: true });
    const repriced = await parseSource({
      filled: true,
      edit: (workbook) => {
        workbook.getWorksheet(FIXTURE_SHEETS.products)!.getCell("K11").value = "13.00";
      },
    });
    const { parsed } = await convertAndRead(repriced);
    expect(sheetValues(parsed, "Variants")[0]!.amount_minor).toBe("1300");
    expect(allKeys(repriced)).toEqual(allKeys(original));
    expect(repriced.fileFingerprint).not.toBe(original.fileFingerprint);

    const renamed = await parseSource({
      filled: true,
      edit: (workbook) => {
        const products = workbook.getWorksheet(FIXTURE_SHEETS.products)!;
        products.getCell("D12").value = "Vanilla Latte (Large)";
        workbook.getWorksheet(FIXTURE_SHEETS.ingredients)!.getCell("L16").value = "Vanilla Latte (Large)";
        workbook.getWorksheet(FIXTURE_SHEETS.assignments)!.getCell("D10").value = "Vanilla Latte (Large)";
      },
    });
    const before = sheetValues(original, "Products").map((row) => row.product_key);
    const after = sheetValues(renamed, "Products").map((row) => row.product_key);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]).toMatch(/^prd~vanilla-latte-large~[0-9a-f]{8}$/);
  });

  it("never carries ignored-sheet content into the converted workbook", async () => {
    const sentinel = "SENTINEL-must-not-leak-216";
    const source = await parseSource({ filled: true, sentinel });
    const bytes = await buildConvertedWorkbook(source, { businessTimezone: "Asia/Dubai" });
    const archive = openZip(bytes, WORKBOOK_LIMITS.ooxml.zip);
    for (const name of archive.names) {
      const text = archive.read(name).toString("utf8");
      expect(text.includes(sentinel), name).toBe(false);
      expect(text.includes("Instruction step"), name).toBe(false);
      expect(text.includes("Example product"), name).toBe(false);
    }
  });

  it("converts the untouched workbook to an empty QOS workbook", async () => {
    const source = await parseSource();
    const { parsed } = await convertAndRead(source);
    expect(parsed.summary.supported.rows + parsed.summary.deferred.rows).toBe(0);
    expect(parsed.summary.errors).toBe(0);
  });

  it("refuses to convert anything but a Foodics menu result, or without a known currency", async () => {
    const template = await parseWorkbookUpload({ fileName: "t.xlsx", bytes: await buildBlankWorkbookTemplate() }, OPTIONS);
    expect(() => assertConvertible(template)).toThrow(WorkbookParseError);
    try {
      assertConvertible(template);
    } catch (error) {
      expect((error as WorkbookParseError).code).toBe("convert_unsupported_profile");
      expect((error as WorkbookParseError).params).toEqual({ profile: "qos_extended_v1" });
    }
    const csv = await parseWorkbookUpload({ fileName: "c.csv", bytes: Buffer.from("a,b\n1,2") }, OPTIONS);
    expect(() => assertConvertible(csv)).toThrow(/current catalogue/);

    const noCurrency = await parseWorkbookUpload(
      { fileName: FOODICS_FIXTURE_FILE_NAME, bytes: await buildFoodicsMenuFixture({ filled: true, prefillLastRow: 40 }) },
      { tenantPublicId: "ten_test" },
    );
    expect(() => assertConvertible(noCurrency)).toThrow(expect.objectContaining({ code: "convert_currency_unresolved" }));
  });

  it("refuses a conversion that would exceed what one QOS workbook can carry", async () => {
    const source = await parseSource({ filled: true });
    const products = source.sheets.find((sheet) => sheet.sheet === "Products")!;
    const oversized: FoodicsMenuParseResult = {
      ...source,
      sheets: source.sheets.map((sheet) =>
        sheet === products
          ? { ...sheet, rowCount: WORKBOOK_LIMITS.maxRowsPerTable + 1, rows: Array.from({ length: WORKBOOK_LIMITS.maxRowsPerTable + 1 }, () => products.rows[0]!) }
          : sheet,
      ),
    };
    await expect(buildConvertedWorkbook(oversized, { businessTimezone: "Asia/Dubai" })).rejects.toMatchObject({
      code: "convert_too_large",
      params: { sheet: "Products", max: 1000 },
    });
  });

  it("names the download after the tenant and the source fingerprint", async () => {
    const source = await parseSource({ filled: true });
    expect(convertedFileName(source)).toBe(`qos-converted-foodics-menu-v1-ten_test-${source.fileFingerprint.slice(0, 8)}.xlsx`);
  });
});
