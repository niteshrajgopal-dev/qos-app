import type { catalogueProductTranslations } from "@/db/schema";

type TranslationRow = typeof catalogueProductTranslations.$inferSelect;

/**
 * When staff accept an AI translation into the administrator queue, we snapshot the
 * pre-accept row so an admin Reject can roll catalogue text back.
 *
 * If no snapshot exists (legacy rows), reject only updates approval_status.
 * When there was never approved copy, the snapshot still captures whatever was on
 * the row before accept (including empty description).
 */
export function adminReviewRevertSnapshotFromRow(row: TranslationRow) {
  return {
    adminReviewRevertDisplayName: row.displayName,
    adminReviewRevertDescription: row.description,
    adminReviewRevertProvenance: row.provenance,
    adminReviewRevertApprovalStatus: row.approvalStatus,
    adminReviewRevertApprovedBySubject: row.approvedBySubject,
    adminReviewRevertApprovedAt: row.approvedAt,
    adminReviewRevertApprovedTranslationVersion: row.approvedTranslationVersion,
    adminReviewRevertApprovedSourceTranslationVersion:
      row.approvedSourceTranslationVersion,
    adminReviewRevertCapturesApprovalFields: true,
  };
}

export function clearAdminReviewRevertSnapshot() {
  return {
    adminReviewRevertDisplayName: null,
    adminReviewRevertDescription: null,
    adminReviewRevertProvenance: null,
    adminReviewRevertApprovalStatus: null,
    adminReviewRevertApprovedBySubject: null,
    adminReviewRevertApprovedAt: null,
    adminReviewRevertApprovedTranslationVersion: null,
    adminReviewRevertApprovedSourceTranslationVersion: null,
    adminReviewRevertCapturesApprovalFields: false,
  };
}

export function adminReviewApprovalFieldsFromSnapshot(
  row: Pick<
    TranslationRow,
    | "adminReviewRevertCapturesApprovalFields"
    | "adminReviewRevertApprovedBySubject"
    | "adminReviewRevertApprovedAt"
    | "adminReviewRevertApprovedTranslationVersion"
    | "adminReviewRevertApprovedSourceTranslationVersion"
  >,
) {
  if (!row.adminReviewRevertCapturesApprovalFields) {
    return {
      approvedBySubject: null,
      approvedAt: null,
      approvedTranslationVersion: null,
      approvedSourceTranslationVersion: null,
    };
  }

  return {
    approvedBySubject: row.adminReviewRevertApprovedBySubject,
    approvedAt: row.adminReviewRevertApprovedAt,
    approvedTranslationVersion: row.adminReviewRevertApprovedTranslationVersion,
    approvedSourceTranslationVersion:
      row.adminReviewRevertApprovedSourceTranslationVersion,
  };
}

export function translationTextMatchesLastApproved(
  row: Pick<
    TranslationRow,
    "lastApprovedDisplayName" | "lastApprovedDescription"
  >,
  displayName: string,
  description: string | null,
) {
  if (row.lastApprovedDisplayName == null) {
    return false;
  }

  const normalizedDescription = description?.trim() || null;
  const lastDescription = row.lastApprovedDescription?.trim() || null;

  return (
    displayName.trim() === row.lastApprovedDisplayName.trim() &&
    normalizedDescription === lastDescription
  );
}
