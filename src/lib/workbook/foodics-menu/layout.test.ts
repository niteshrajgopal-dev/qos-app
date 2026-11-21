import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildCatalogueImportSampleXlsx, CATALOGUE_IMPORT_SAMPLE_CSV } from "@/lib/catalogue/catalogue-import-sample";
import { WorkbookParseError } from "@/lib/workbook/errors";
import {
  buildFoodicsMenuFixture,
  FIXTURE_HEADERS,
  FIXTURE_SHEETS,
  FOODICS_FIXTURE_FILE_NAME,
  writeRow,
} from "@/lib/workbook/foodics-menu/fixture";
import {
  channelLabelOf,
  classifyIgnoredSheetHeader,
  classifyIgnoredSheetName,
  matchRegionHeaders,
  normalizeHeader,
  regionSpec,
} from "@/lib/workbook/foodics-menu/layout";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";
import type { PackageSheet } from "@/lib/workbook/ooxml";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { buildBlankWorkbookTemplate } from "@/lib/workbook/template";

const OPTIONS = { tenantCurrency: "AED", tenantPublicId: "ten_test" };

async function parse(bytes: Buffer, fileName = FOODICS_FIXTURE_FILE_NAME) {
  return parseWorkbookUpload({ fileName, bytes }, OPTIONS);
}

async function layoutError(edit: (workbook: ExcelJS.Workbook) => void) {
  try {
    await parse(await buildFoodicsMenuFixture({ edit, prefillLastRow: 40 }));
  } catch (error) {
    if (error instanceof WorkbookParseError) return error;
    throw error;
  }
  throw new Error("expected a WorkbookParseError");
}

function clearRange(worksheet: ExcelJS.Worksheet, row: number, startColumn: number, width: number) {
  for (let column = startColumn; column < startColumn + width; column += 1) {
    worksheet.getCell(row, column).value = null;
  }
}

describe("Foodics menu profile detection", () => {
  it("recognises the untouched layout by structure, never as the legacy flat profile", async () => {
    const result = await parse(await buildFoodicsMenuFixture());
    expect(result.profile).toBe("foodics_menu_v1");
    expect(result).not.toHaveProperty("suggestedMapping");
    const foodics = result as FoodicsMenuParseResult;
    expect(foodics.layout.regions.map((region) => [region.id, region.sheet, region.headerRef, region.dataStartRow])).toEqual([
      ["categories", "Categories", "F4:G4", 8],
      ["products", "Products", "D6:V6", 11],
      ["ingredients", "Ingredients", "D7:J7", 18],
      ["product_recipe_lines", "Ingredients", "L7:N7", 15],
      ["modifiers", "Modifiers", "F8:O8", 13],
      ["modifier_ingredient_lines", "Modifiers", "R8:T8", 13],
      ["assignments", "Product Modifiers", "D6:I6", 9],
      ["prepared_recipe_lines", "Prepared Items", "I6:K6", 10],
    ]);
    expect(foodics.layout.ignoredSheets).toEqual([
      { sheet: "Instructions", reason: "guidance" },
      { sheet: "Dashboard", reason: "guidance" },
      { sheet: "Lists", reason: "guidance" },
      { sheet: "Users", reason: "credentials" },
    ]);
  });

  it("does not depend on the file name or sheet names", async () => {
    const bytes = await buildFoodicsMenuFixture({
      edit: (workbook) => {
        workbook.getWorksheet(FIXTURE_SHEETS.products)!.name = "Menu items 2026";
        workbook.getWorksheet(FIXTURE_SHEETS.categories)!.name = "تصنيفات";
      },
    });
    const result = (await parse(bytes, "anything.xlsx")) as FoodicsMenuParseResult;
    expect(result.profile).toBe("foodics_menu_v1");
    expect(result.layout.regions.find((region) => region.id === "products")?.sheet).toBe("Menu items 2026");
    expect(result.layout.regions.find((region) => region.id === "categories")?.sheet).toBe("تصنيفات");
  });

  it("keeps the other profiles: the QOS template, a plain first-sheet XLSX and CSV", async () => {
    expect((await parse(await buildBlankWorkbookTemplate(), "template.xlsx")).profile).toBe("qos_extended_v1");
    expect((await parse(await buildCatalogueImportSampleXlsx(), "sample.xlsx")).profile).toBe("legacy_flat");
    expect((await parse(Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV), "sample.csv")).profile).toBe("legacy_flat");

    // The instructions sheet on its own has no region anchors: it is still the flat profile.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Instructions");
    writeRow(sheet, "A1", ["column_1", "column", "row", "AR", "EN"]);
    writeRow(sheet, "A2", [1, "Step 1", 2, "الخطوة 1", "Instruction"]);
    expect((await parse(Buffer.from(await workbook.xlsx.writeBuffer()), "x.xlsx")).profile).toBe("legacy_flat");
  });

  it("refuses a moved header with the row it was found on", async () => {
    const error = await layoutError((workbook) => {
      const products = workbook.getWorksheet(FIXTURE_SHEETS.products)!;
      clearRange(products, 6, 4, 19);
      writeRow(products, "D7", [...FIXTURE_HEADERS.products]);
    });
    expect(error.code).toBe("source_layout_partial");
    expect(error.params).toMatchObject({ region: "products", sheet: "Products", expectedRef: "D6:V6", foundRow: 7 });
  });

  it("refuses columns shifted sideways", async () => {
    const error = await layoutError((workbook) => {
      const products = workbook.getWorksheet(FIXTURE_SHEETS.products)!;
      clearRange(products, 6, 4, 19);
      writeRow(products, "E6", [...FIXTURE_HEADERS.products]);
    });
    expect(error.code).toBe("source_layout_partial");
    expect(error.params).toMatchObject({ region: "products", foundColumn: "E" });
  });

  it("refuses a renamed required header and names the missing role", async () => {
    const error = await layoutError((workbook) => {
      workbook.getWorksheet(FIXTURE_SHEETS.products)!.getCell("K6").value = "Amount";
    });
    expect(error.code).toBe("source_layout_partial");
    expect(error.params).toMatchObject({ region: "products", sheet: "Products", missingHeaders: "price", populated: 19, width: 19 });
  });

  it("refuses a workbook whose required Categories sheet was deleted", async () => {
    const error = await layoutError((workbook) => {
      workbook.removeWorksheet(workbook.getWorksheet(FIXTURE_SHEETS.categories)!.id);
    });
    expect(error.code).toBe("source_layout_partial");
    expect(error.params).toMatchObject({ region: "categories", sheet: "", expectedRef: "F4:G4", missingHeaders: "name_en" });
    expect(JSON.parse(String(error.params.details))).toEqual([expect.objectContaining({ region: "categories" })]);
  });

  it("refuses a layout that appears on two sheets", async () => {
    const error = await layoutError((workbook) => {
      const copy = workbook.addWorksheet("Products (old)");
      writeRow(copy, "D6", [...FIXTURE_HEADERS.products]);
    });
    expect(error.code).toBe("source_layout_ambiguous");
    expect(error.params).toMatchObject({ region: "products", sheet: "Products, Products (old)" });
  });

  it("accepts a menu-only workbook without the ingredient sheet and says so", async () => {
    const bytes = await buildFoodicsMenuFixture({
      edit: (workbook) => workbook.removeWorksheet(workbook.getWorksheet(FIXTURE_SHEETS.ingredients)!.id),
    });
    const result = (await parse(bytes)) as FoodicsMenuParseResult;
    expect(result.profile).toBe("foodics_menu_v1");
    expect(result.issues.filter((issue) => issue.code === "region_absent").map((issue) => issue.params?.region)).toEqual([
      "ingredients",
      "product_recipe_lines",
    ]);
  });

  it("refuses recipe-line headers that left the ingredients sheet", async () => {
    const error = await layoutError((workbook) => {
      const ingredients = workbook.getWorksheet(FIXTURE_SHEETS.ingredients)!;
      clearRange(ingredients, 7, 12, 3);
      writeRow(workbook.getWorksheet(FIXTURE_SHEETS.prepared)!, "L7", [...FIXTURE_HEADERS.productRecipeLines]);
    });
    expect(error.code).toBe("source_layout_partial");
    expect(error.params).toMatchObject({ region: "product_recipe_lines" });
  });
});

describe("header dictionary", () => {
  it("normalises labels and matches roles by alias, with position only as a tiebreaker", () => {
    expect(normalizeHeader("Price (AED)*")).toBe("price aed");
    expect(normalizeHeader("Tax_%")).toBe("tax %");
    expect(normalizeHeader("  Product-Name  ")).toBe("product name");
    expect(normalizeHeader("الاسم:")).toBe("الاسم");
    expect(channelLabelOf("dine in price aed")).toBe("dine in");
    expect(channelLabelOf("price")).toBeNull();
    expect(channelLabelOf("cost price")).toBeNull();
    expect(channelLabelOf("talabat price")).toBe("talabat");

    const cells = new Map<string, { kind: "string"; text: string; formula: boolean }>();
    ["Name (EN) / الاسم", "Arabic name"].forEach((text, offset) => cells.set(`4:${6 + offset}`, { kind: "string", text, formula: false }));
    const sheet: PackageSheet = { name: "x", state: "visible", tables: [], cells };
    const matched = matchRegionHeaders(sheet, regionSpec("categories"), 4, 6);
    expect(matched.matches).toBe(true);
    expect(matched.columns.map((column) => column.role)).toEqual(["name_en", "name_ar"]);

    // Two headers for one role: the expected slot wins, the other is unmapped.
    cells.set("4:6", { kind: "string", text: "Arabic name", formula: false });
    cells.set("4:7", { kind: "string", text: "Name", formula: false });
    const swapped = matchRegionHeaders(sheet, regionSpec("categories"), 4, 6);
    expect(swapped.columns.map((column) => column.role)).toEqual(["name_ar", "name_en"]);
  });

  it("keeps aliases unique inside each region", () => {
    for (const id of ["categories", "products", "ingredients", "product_recipe_lines", "modifiers", "modifier_ingredient_lines", "assignments", "prepared_recipe_lines"] as const) {
      const aliases = regionSpec(id).roles.flatMap((role) => role.aliases);
      expect(new Set(aliases).size, id).toBe(aliases.length);
      for (const alias of aliases) expect(normalizeHeader(alias), alias).toBe(alias);
    }
  });

  it("classifies account sheets by name or credential headers", () => {
    for (const header of ["Password", "PIN", "pin code", "Passcode", "API token", "Secret", "User password", "كلمة المرور / Password"]) {
      expect(classifyIgnoredSheetHeader(header), header).toBe(true);
    }
    for (const header of ["Name", "Email", "Role", "Pinned", "Spinach", "Instructions"]) {
      expect(classifyIgnoredSheetHeader(header), header).toBe(false);
    }
    expect(classifyIgnoredSheetName("Users")).toBe(true);
    expect(classifyIgnoredSheetName(" staff ")).toBe(true);
    expect(classifyIgnoredSheetName("Products")).toBe(false);
  });
});
