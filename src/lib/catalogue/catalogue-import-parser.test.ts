import { describe, expect, it } from "vitest";

import {
  IMPORT_LIMITS,
  parseSpreadsheetUpload,
  sanitizeSpreadsheetCell,
  suggestColumnMapping,
} from "@/lib/catalogue/catalogue-import-parser";
import { CATALOGUE_IMPORT_SAMPLE_CSV } from "@/lib/catalogue/catalogue-import-sample";
import { writeWorksheetMatrix } from "@/lib/catalogue/catalogue-import-xlsx";

describe("catalogue import parser", () => {
  it("sanitizes spreadsheet formula prefixes", () => {
    expect(sanitizeSpreadsheetCell("=1+1")).toBe("'=1+1");
    expect(sanitizeSpreadsheetCell("+cmd")).toBe("'+cmd");
    expect(sanitizeSpreadsheetCell("-value")).toBe("'-value");
    expect(sanitizeSpreadsheetCell("@import")).toBe("'@import");
    expect(sanitizeSpreadsheetCell("Flat White")).toBe("Flat White");
  });

  it("parses CSV with Arabic Unicode and AED minor units", async () => {
    const parsed = await parseSpreadsheetUpload({
      fileName: "quotes-synthetic.csv",
      bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
    });

    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]?.display_name_en).toBe("Flat White");
    expect(parsed.rows[0]?.display_name_ar).toBe("فلات وايت");
    expect(parsed.rows[0]?.amount_minor).toBe("1800");
    expect(parsed.rows[2]?.display_name_en).toBe("'=SUM(1,2)");
  });

  it("parses the first worksheet from XLSX uploads", async () => {
    const bytes = await writeWorksheetMatrix("catalogue", [
      [
        "source_id",
        "internal_name",
        "display_name_en",
        "display_name_ar",
        "amount_minor",
        "currency",
      ],
      [
        "xlsx-001",
        "rose-bouquet",
        "Rose Bouquet",
        "باقة ورد",
        "9900",
        "AED",
      ],
    ]);

    const parsed = await parseSpreadsheetUpload({
      fileName: "flower-shop.xlsx",
      bytes,
    });

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.display_name_ar).toBe("باقة ورد");
    expect(parsed.rows[0]?.amount_minor).toBe("9900");
  });

  it("suggests common column headers", () => {
    const mapping = suggestColumnMapping([
      "source_id",
      "internal_name",
      "display_name_en",
      "display_name_ar",
      "amount_minor",
      "currency",
    ]);

    expect(mapping.sourceId).toBe("source_id");
    expect(mapping.displayNameAr).toBe("display_name_ar");
    expect(mapping.amountMinor).toBe("amount_minor");
  });

  it("rejects oversize files", async () => {
    await expect(
      parseSpreadsheetUpload({
        fileName: "too-large.csv",
        bytes: Buffer.alloc(IMPORT_LIMITS.maxFileBytes + 1),
      }),
    ).rejects.toThrow(/byte limit/i);
  });
});
