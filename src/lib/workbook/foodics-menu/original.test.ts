import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classifyIgnoredSheetHeader } from "@/lib/workbook/foodics-menu/layout";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { cellKey, readXlsxPackage } from "@/lib/workbook/ooxml";
import { parseWorkbookUpload } from "@/lib/workbook/reader";

/* QOS-216 recognition check against the client's original workbook. The
   file is private and never committed: the test runs only when
   QOS_216_SOURCE_XLSX or /workspace/qos-phase2/private/ provides it, and
   fails loudly if that file is not the SHA-verified original. */

const ORIGINAL_SHA256 = "2a73c4f19c98e35803b026038b08439a5f0f77070f88e59e4356623ded3e4cd3";
const PRIVATE_DIR = "/workspace/qos-phase2/private";

function originalPath() {
  const fromEnv = process.env.QOS_216_SOURCE_XLSX;
  if (fromEnv) return fromEnv;
  if (!existsSync(PRIVATE_DIR)) return null;
  const candidate = readdirSync(PRIVATE_DIR).find((name) => name.toLowerCase().endsWith(".xlsx"));
  return candidate ? path.join(PRIVATE_DIR, candidate) : null;
}

const source = originalPath();

describe("original client workbook (local only, never committed)", () => {
  it.skipIf(!source)("is recognised as the Foodics menu layout with zero customer business rows", async () => {
    const bytes = readFileSync(source!);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ORIGINAL_SHA256);

    const result = (await parseWorkbookUpload(
      { fileName: path.basename(source!), bytes },
      { tenantCurrency: "AED", tenantPublicId: "ten_original_check" },
    )) as FoodicsMenuParseResult;
    expect(result.profile).toBe("foodics_menu_v1");
    expect(result.layout.regions.map((region) => [region.id, region.headerRef])).toEqual([
      ["categories", "F4:G4"],
      ["products", "D6:V6"],
      ["ingredients", "D7:J7"],
      ["product_recipe_lines", "L7:N7"],
      ["modifiers", "F8:O8"],
      ["modifier_ingredient_lines", "R8:T8"],
      ["assignments", "D6:I6"],
      ["prepared_recipe_lines", "I6:K6"],
    ]);
    for (const sheet of result.sheets) {
      expect(sheet.rowCount, sheet.sheet).toBe(0);
    }
    expect(result.issues.filter((issue) => issue.code === "example_rows_skipped").map((issue) => issue.params?.range)).toEqual([
      "F5:G7",
      "D7:V10",
      "D8:J17",
      "L8:N14",
      "F9:O12",
      "R9:T12",
      "D7:I8",
      "I7:K9",
    ]);

    const credentialSheets = result.layout.ignoredSheets.filter((sheet) => sheet.reason === "credentials");
    expect(credentialSheets.length).toBeGreaterThan(0);
    // No header text from an account sheet appears anywhere in the result.
    const pkg = readXlsxPackage(bytes, WORKBOOK_LIMITS.ooxml);
    const serialized = JSON.stringify({ ...result, layout: { ...result.layout, ignoredSheets: [] } });
    const regionHeaders = new Set(result.layout.regions.flatMap((region) => region.unmappedHeaders));
    for (const { sheet: name } of credentialSheets) {
      const sheet = pkg.sheets.find((entry) => entry.name === name)!;
      for (let row = 1; row <= 15; row += 1) {
        for (let column = 1; column <= 30; column += 1) {
          const header = sheet.cells.get(cellKey(row, column))?.text.trim();
          if (!header || regionHeaders.has(header)) continue;
          if (classifyIgnoredSheetHeader(header) || header.length > 3) {
            expect(serialized.includes(`"${header}"`), `${name}!${row}:${column}`).toBe(false);
          }
        }
      }
    }
  });
});
