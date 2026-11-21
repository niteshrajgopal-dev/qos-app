import ExcelJS from "exceljs";

import type { StaffLocale } from "@/lib/staff/locale";
import { describeReviewDiagnostic, diagnosticLocation } from "@/lib/workbook/review-view";
import type { WorkbookReviewResult } from "@/lib/workbook/validation/model";

/* Downloadable correction report for a stored plan (QOS-194, decision D-UI).
   One row per diagnostic, with the sheet, row and cell to correct and the
   responsible row for blocked rows; a summary of counts and field decisions;
   and the plan context. Built only from the stored plan: no ignored-sheet
   content and no credential text can reach it. XLSX keeps Arabic intact. */

export const CORRECTION_COLUMNS = [
  "plan",
  "revision",
  "sheet",
  "row",
  "cell",
  "key",
  "name_en",
  "name_ar",
  "classification",
  "severity",
  "code",
  "message",
  "expected",
  "found",
  "responsible_sheet",
  "responsible_row",
  "decision_needed",
] as const;

const NEEDS_DECISION = new Set(["conflicting"]);

function addTable(worksheet: ExcelJS.Worksheet, header: readonly string[], rows: Array<Array<string | number>>) {
  worksheet.addRow([...header]).font = { bold: true };
  for (const values of rows) {
    const row = worksheet.addRow(values);
    row.eachCell((cell) => {
      if (typeof cell.value === "string") cell.numFmt = "@";
    });
  }
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
}

export function correctionReportFileName(result: Pick<WorkbookReviewResult, "plan">) {
  const id = result.plan.publicId.replace(/[^A-Za-z0-9_-]/g, "");
  return `qos-correction-report-${id}-r${result.plan.revision}.xlsx`;
}

export function correctionRows(result: WorkbookReviewResult, locale: StaffLocale) {
  const rows: Array<Array<string | number>> = [];
  for (const row of result.rows) {
    for (const diagnostic of row.diagnostics) {
      if (diagnostic.severity === "info") continue;
      const params = diagnostic.params ?? {};
      rows.push([
        result.plan.publicId,
        result.plan.revision,
        row.sheet,
        row.row,
        diagnosticLocation(row, diagnostic),
        row.key,
        row.label.en,
        row.label.ar,
        row.classification,
        diagnostic.severity,
        diagnostic.code,
        describeReviewDiagnostic(locale, diagnostic),
        String(params.expected ?? params.allowed ?? ""),
        String(params.value ?? params.found ?? params.current ?? ""),
        diagnostic.responsible?.sheet ?? "",
        diagnostic.responsible?.row ?? "",
        NEEDS_DECISION.has(row.classification) ? "yes" : "",
      ]);
    }
  }
  return rows;
}

export async function buildCorrectionReport(result: WorkbookReviewResult, locale: StaffLocale) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QOS";
  const fixed = new Date(result.plan.reviewedAt);
  workbook.created = fixed;
  workbook.modified = fixed;

  const corrections = workbook.addWorksheet("Corrections", { views: [{ rightToLeft: locale === "ar" }] });
  addTable(corrections, CORRECTION_COLUMNS, correctionRows(result, locale));

  const summary = workbook.addWorksheet("Summary");
  addTable(
    summary,
    ["measure", "value"],
    Object.entries(result.counts).map(([measure, value]) => [measure, value]),
  );
  summary.addRow([]);
  summary.addRow(["sheet", "column", "decision", "owner", "rows_with_values"]).font = { bold: true };
  for (const field of result.fieldDecisions) {
    summary.addRow([field.sheet, field.column, field.decision, field.owner, field.rowsWithValues]);
  }

  const context = workbook.addWorksheet("Context");
  addTable(context, ["field", "value"], [
    ["plan", result.plan.publicId],
    ["revision", result.plan.revision],
    ["status", result.plan.status],
    ["plan_hash", result.plan.planHash],
    ["snapshot_hash", result.plan.snapshotHash],
    ["engine_version", result.plan.engineVersion],
    ["tenant_public_id", result.context.tenantPublicId],
    ["brand_public_id", result.context.brandPublicId],
    ["currency", result.context.currency],
    ["source_profile", result.context.profile],
    ["source_namespace", result.context.sourceNamespace],
    ["keys_verified", result.context.keysVerified ? "TRUE" : "FALSE"],
    ["file_name", result.context.fileName],
    ["file_fingerprint", result.context.fileFingerprint],
    ["branch_scope", result.context.branchScope === "all" ? "all" : result.context.branchScope.join(", ")],
    ["reviewed_at", result.plan.reviewedAt],
  ]);
  for (const worksheet of [corrections, summary, context]) {
    worksheet.columns.forEach((column) => {
      column.width = 22;
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
