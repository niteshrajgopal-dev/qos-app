import { exportSourceNamespace } from "@/lib/workbook/export";
import { assertConvertible } from "@/lib/workbook/foodics-menu/convert";
import { FOODICS_MENU_PROFILE } from "@/lib/workbook/foodics-menu/layout";
import { foodicsSourceNamespace } from "@/lib/workbook/foodics-menu/reader";
import type { WorkbookIssue, WorkbookParseResult } from "@/lib/workbook/reader";
import { WorkbookReviewError } from "@/lib/workbook/validation/errors";
import type { ReviewInput, ReviewInputSheet } from "@/lib/workbook/validation/model";

/* One review path for both profiles (QOS-194, decision D-INPUT). A QOS
   workbook is reviewed from its parsed tables; a Foodics menu workbook from
   the in-memory canonical rows #93 already produces (after assertConvertible),
   never from a converted file. Context that names another business, brand or
   namespace rejects the whole upload before anything is stored. */

export type ReviewInputOptions = {
  tenantPublicId: string;
  /** The brand the review is for, already resolved against the tenant. */
  brandPublicId: string;
  currency: string;
};

function rejected(reason: string, found: string, expected: string): never {
  throw new WorkbookReviewError("review_context_rejected", "The workbook context does not match this business.", 409, {
    reason,
    found,
    expected,
  });
}

function sheetsOf(result: { sheets: Array<ReviewInputSheet & { table?: string }> }): ReviewInputSheet[] {
  return result.sheets.map((sheet) => ({
    sheet: sheet.sheet,
    support: sheet.support,
    present: sheet.present,
    columns: sheet.columns,
    rows: sheet.rows,
    issues: sheet.issues,
  }));
}

function allIssues(result: { issues: WorkbookIssue[]; sheets: Array<{ issues: WorkbookIssue[] }> }) {
  return [...result.issues, ...result.sheets.flatMap((sheet) => sheet.issues)];
}

export function toReviewInput(result: WorkbookParseResult, options: ReviewInputOptions): ReviewInput {
  if (result.profile === "legacy_flat") {
    throw new WorkbookReviewError(
      "review_unsupported_profile",
      "This file uses the current catalogue profile; review it with the current catalogue import.",
      400,
      { profile: result.profile },
    );
  }

  if (result.profile === "foodics_menu_v1") {
    assertConvertible(result);
    const expectedNamespace = foodicsSourceNamespace(options.tenantPublicId);
    if (result.context.tenantPublicId !== options.tenantPublicId) {
      rejected("tenant", result.context.tenantPublicId, options.tenantPublicId);
    }
    if (result.context.sourceNamespace !== expectedNamespace) {
      rejected("namespace", result.context.sourceNamespace, expectedNamespace);
    }
    return {
      profile: "foodics_menu_v1",
      sourceProfile: FOODICS_MENU_PROFILE.id,
      fileName: result.fileName,
      fileFingerprint: result.fileFingerprint,
      sourceFileSha256: result.fileFingerprint,
      templateVersion: result.templateVersion,
      dictionaryVersion: result.dictionaryVersion,
      tenantPublicId: options.tenantPublicId,
      brandPublicId: options.brandPublicId,
      currency: options.currency,
      sourceNamespace: expectedNamespace,
      // Keys are derived from source names: never verified identities.
      keysVerified: false,
      isExport: false,
      requiredMappings: result.requiredMappings,
      capabilities: result.capabilities,
      ignoredSheets: result.layout.ignoredSheets,
      sheets: sheetsOf(result),
      parseIssues: allIssues(result),
    };
  }

  const issues = allIssues(result);
  const mismatch = issues.find((issue) => issue.code === "tenant_mismatch" || issue.code === "brand_mismatch");
  if (mismatch) {
    rejected(mismatch.code === "tenant_mismatch" ? "tenant" : "brand", String(mismatch.params?.found ?? ""), String(mismatch.params?.expected ?? ""));
  }

  const manifest = result.manifest;
  const extensions = result.manifestExtensions ?? {};
  const sourceProfile = extensions.source_profile?.trim() || null;
  if (sourceProfile && sourceProfile !== FOODICS_MENU_PROFILE.id) {
    rejected("source_profile", sourceProfile, FOODICS_MENU_PROFILE.id);
  }
  if (manifest.tenant_public_id && manifest.tenant_public_id !== options.tenantPublicId) {
    rejected("tenant", manifest.tenant_public_id, options.tenantPublicId);
  }
  if (result.isExport && manifest.brand_public_id !== options.brandPublicId) {
    rejected("brand", manifest.brand_public_id, options.brandPublicId);
  }
  if (manifest.brand_public_id && manifest.brand_public_id !== options.brandPublicId) {
    rejected("brand", manifest.brand_public_id, options.brandPublicId);
  }

  const qosNamespace = exportSourceNamespace(options.tenantPublicId);
  const foodicsNamespace = foodicsSourceNamespace(options.tenantPublicId);
  const namespace = manifest.source_namespace.trim();
  let sourceNamespace: string;
  if (!namespace) {
    // A hand-filled template has no namespace yet (decision D-BLANK-NS). An
    // export or a converted workbook always carries one.
    if (result.isExport || sourceProfile) {
      rejected("namespace", "", sourceProfile ? foodicsNamespace : qosNamespace);
    }
    sourceNamespace = qosNamespace;
  } else if (namespace === qosNamespace || namespace === foodicsNamespace) {
    sourceNamespace = namespace;
  } else {
    rejected("namespace", namespace, qosNamespace);
  }
  if (sourceProfile && sourceNamespace !== foodicsNamespace) {
    rejected("namespace", sourceNamespace, foodicsNamespace);
  }

  return {
    profile: "qos_extended_v1",
    sourceProfile,
    fileName: result.fileName,
    fileFingerprint: result.fileFingerprint,
    ...(extensions.source_file_sha256 ? { sourceFileSha256: extensions.source_file_sha256 } : {}),
    templateVersion: result.templateVersion,
    dictionaryVersion: extensions.dictionary_version?.trim() || null,
    tenantPublicId: options.tenantPublicId,
    brandPublicId: options.brandPublicId,
    currency: options.currency,
    sourceNamespace,
    // Keys are QOS public ids only in a QOS export namespace with typed context.
    keysVerified: Boolean(namespace) && sourceNamespace === qosNamespace,
    isExport: result.isExport,
    ...(manifest.export_revision ? { exportRevision: manifest.export_revision } : {}),
    sheets: sheetsOf(result),
    parseIssues: issues,
  };
}
