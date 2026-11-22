import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildCorrectionReport, CORRECTION_COLUMNS, correctionReportFileName } from "@/lib/workbook/validation/correction-report";
import type { WorkbookReviewResult } from "@/lib/workbook/validation/model";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { emptySnapshot, qosInput } from "@/lib/workbook/validation/test-support";

function result(): WorkbookReviewResult {
  const review = reviewWorkbook(
    qosInput(
      {
        Products: [{ product_key: "p1", action: "create", internal_name: "latte", display_name_en: "Latte", display_name_ar: "", status: "draft" }],
        Categories: [{ category_key: "c1", action: "create", internal_name: "hot", display_name_en: "Hot", display_name_ar: "ساخن", sort_order: "1", status: "draft" }],
        "Product Categories": [{ product_category_key: "p1~c1", action: "create", product_key: "p1", category_key: "c1", sort_order: "1" }],
        Variants: [{ variant_key: "v1", action: "create", product_key: "p1", is_default: "TRUE", sort_order: "0", amount_minor: "12.50", currency: "AED", status: "draft" }],
      },
      { keysVerified: false, isExport: false },
    ),
    emptySnapshot(),
  );
  return {
    ...review,
    plan: {
      publicId: "wbp_0123456789abcdef",
      revision: 2,
      status: "review_ready",
      planHash: "h".repeat(64),
      snapshotHash: "s".repeat(64),
      engineVersion: "qos194.1",
      createdAt: "2026-11-22T00:00:00.000Z",
      reviewedAt: "2026-11-22T00:00:00.000Z",
      createdBySubject: "alice",
    },
  };
}

async function sheetValues(bytes: Buffer, name: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const worksheet = workbook.getWorksheet(name)!;
  const rows: unknown[][] = [];
  worksheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return { rows, worksheet };
}

describe("correction report", () => {
  it("has one row per error or warning with its location, and EN and AR differ only in message text", async () => {
    const plan = result();
    const errors = plan.rows.flatMap((row) => row.diagnostics.filter((diagnostic) => diagnostic.severity !== "info"));
    expect(errors.length).toBeGreaterThanOrEqual(3);

    const en = await sheetValues(await buildCorrectionReport(plan, "en"), "Corrections");
    const ar = await sheetValues(await buildCorrectionReport(plan, "ar"), "Corrections");
    expect(en.rows[0]).toEqual([...CORRECTION_COLUMNS]);
    expect(en.rows).toHaveLength(errors.length + 1);
    expect(ar.rows).toHaveLength(errors.length + 1);

    const messageIndex = CORRECTION_COLUMNS.indexOf("message");
    for (let index = 1; index < en.rows.length; index += 1) {
      const withoutMessage = (row: unknown[]) => row.filter((_, column) => column !== messageIndex);
      expect(withoutMessage(ar.rows[index]!)).toEqual(withoutMessage(en.rows[index]!));
      expect(ar.rows[index]![messageIndex]).not.toBe(en.rows[index]![messageIndex]);
      expect(String(ar.rows[index]![messageIndex])).toMatch(/[؀-ۿ]/);
    }
    const codes = en.rows.slice(1).map((row) => row[CORRECTION_COLUMNS.indexOf("code")]);
    expect(codes).toEqual(expect.arrayContaining(["required_missing", "malformed_minor_units", "blocked_by_dependency"]));
    const blocked = en.rows.find((row) => row[CORRECTION_COLUMNS.indexOf("code")] === "blocked_by_dependency")!;
    expect(blocked[CORRECTION_COLUMNS.indexOf("responsible_sheet")]).toBe("Products");
    expect(blocked[CORRECTION_COLUMNS.indexOf("responsible_row")]).toBe(7);
    expect(en.worksheet.getCell("C2").numFmt).toBe("@");
  });

  it("carries the summary and the plan context, and is named after the plan and revision", async () => {
    const plan = result();
    const bytes = await buildCorrectionReport(plan, "en");
    const context = await sheetValues(bytes, "Context");
    expect(context.rows).toContainEqual(["plan_hash", "h".repeat(64)]);
    expect(context.rows).toContainEqual(["source_namespace", "qos:ten_quotes_dev"]);
    const summary = await sheetValues(bytes, "Summary");
    expect(summary.rows).toContainEqual(["invalid", plan.counts.invalid]);
    expect(correctionReportFileName(plan)).toBe("qos-correction-report-wbp_0123456789abcdef-r2.xlsx");
  });
});
