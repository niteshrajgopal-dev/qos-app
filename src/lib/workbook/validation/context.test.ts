import { describe, expect, it } from "vitest";

import { exportSourceNamespace } from "@/lib/workbook/export";
import type { ExtendedWorkbookParseResult, LegacyWorkbookParseResult } from "@/lib/workbook/reader";
import { WorkbookReviewError } from "@/lib/workbook/validation/errors";
import { toReviewInput } from "@/lib/workbook/validation/input";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { BRAND, qosInput, snapshotFrom, TENANT } from "@/lib/workbook/validation/test-support";

const OPTIONS = { tenantPublicId: TENANT, brandPublicId: BRAND, currency: "AED" };

function extended(manifest: Partial<ExtendedWorkbookParseResult["manifest"]>, extra: Partial<ExtendedWorkbookParseResult> = {}): ExtendedWorkbookParseResult {
  return {
    profile: "qos_extended_v1",
    fileName: "w.xlsx",
    fileFingerprint: "a".repeat(64),
    templateVersion: "1.0",
    manifest: {
      profile: "qos-extended-v1-proposed",
      template_version: "1.0",
      prepared_on: "",
      tenant_public_id: "",
      brand_public_id: "",
      source_namespace: "",
      export_revision: "",
      exported_at: "",
      pilot_currency: "AED",
      business_timezone: "Asia/Dubai",
      ...manifest,
    },
    isExport: Boolean(manifest.export_revision),
    guidanceSheets: [],
    sheets: [],
    issues: [],
    summary: { supported: { sheets: 0, rows: 0 }, deferred: { sheets: 0, rows: 0 }, rejected: { sheets: 0, rows: 0 }, separate_profile: { sheets: 0, rows: 0 }, errors: 0, warnings: 0 },
    ...extra,
  };
}

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkbookReviewError);
    return error as WorkbookReviewError;
  }
  throw new Error("expected a rejection");
}

describe("review context", () => {
  it("rejects another tenant, brand or namespace before anything is stored", () => {
    expect(rejection(() => toReviewInput(extended({ tenant_public_id: "ten_flowers_dev" }), OPTIONS))).toMatchObject({
      code: "review_context_rejected",
      statusCode: 409,
      details: { reason: "tenant", found: "ten_flowers_dev" },
    });
    expect(rejection(() => toReviewInput(extended({ brand_public_id: "brd_other" }), OPTIONS)).details).toMatchObject({ reason: "brand" });
    expect(rejection(() => toReviewInput(extended({ source_namespace: "qos:ten_flowers_dev" }), OPTIONS)).details).toMatchObject({ reason: "namespace" });
    expect(rejection(() => toReviewInput(extended({ source_namespace: "something" }), OPTIONS)).details).toMatchObject({ reason: "namespace" });
    expect(
      rejection(() =>
        toReviewInput(extended({}, { issues: [{ severity: "error", code: "tenant_mismatch", params: { found: "ten_x", expected: TENANT } }] }), OPTIONS),
      ).details,
    ).toMatchObject({ reason: "tenant", found: "ten_x" });
    expect(
      rejection(() => toReviewInput(extended({ source_namespace: exportSourceNamespace(TENANT) }, { manifestExtensions: { source_profile: "toast_v1" } }), OPTIONS)).details,
    ).toMatchObject({ reason: "source_profile" });
    expect(
      rejection(() => toReviewInput(extended({ export_revision: "rv1.AAAAAAAAAAAAAAAAAAAAAA", tenant_public_id: TENANT, brand_public_id: BRAND }), OPTIONS)).details,
    ).toMatchObject({ reason: "namespace" });
  });

  it("accepts a blank-namespace hand-filled template as qos:<tenant> with unverified keys", () => {
    const input = toReviewInput(extended({}), OPTIONS);
    expect(input).toMatchObject({ sourceNamespace: `qos:${TENANT}`, keysVerified: false, isExport: false });
    const exported = toReviewInput(
      extended({ tenant_public_id: TENANT, brand_public_id: BRAND, source_namespace: `qos:${TENANT}`, export_revision: "rv1.AAAAAAAAAAAAAAAAAAAAAA" }),
      OPTIONS,
    );
    expect(exported).toMatchObject({ keysVerified: true, isExport: true, exportRevision: "rv1.AAAAAAAAAAAAAAAAAAAAAA" });
    const converted = toReviewInput(
      extended({ tenant_public_id: TENANT, source_namespace: `foodics-menu-v1:${TENANT}` }, { manifestExtensions: { source_profile: "foodics_menu_v1", dictionary_version: "1.1" } }),
      OPTIONS,
    );
    expect(converted).toMatchObject({ keysVerified: false, sourceProfile: "foodics_menu_v1", dictionaryVersion: "1.1" });
  });

  it("notes an outdated export without rejecting it", () => {
    const review = reviewWorkbook(qosInput({}, { exportRevision: "rv1.AAAAAAAAAAAAAAAAAAAAAA" }), snapshotFrom({ exportRevision: "rv1.BBBBBBBBBBBBBBBBBBBBBB" }));
    expect(review.notices).toEqual([expect.objectContaining({ code: "export_outdated", severity: "info" })]);
  });

  it("refuses the current catalogue profile", () => {
    const legacy: LegacyWorkbookParseResult = {
      profile: "legacy_flat",
      container: "csv",
      fileName: "a.csv",
      fileFingerprint: "b".repeat(64),
      headers: [],
      rowCount: 0,
      rows: [],
      suggestedMapping: {} as LegacyWorkbookParseResult["suggestedMapping"],
      warnings: [],
    };
    expect(rejection(() => toReviewInput(legacy, OPTIONS))).toMatchObject({ code: "review_unsupported_profile", statusCode: 400 });
  });
});
