import { createHash } from "node:crypto";

import type { PlanDecision, ReviewClassification, ReviewDeferredField, ReviewOperation } from "@/lib/workbook/validation/model";

/* Tamper evidence for a persisted plan (QOS-194, plan section 3.3). The hash
   binds the file, the actor and role, the branch scope, the snapshot of the
   records the review compared against, every row's outcome and every
   decision. QOS-217 recomputes it with this function over the stored rows
   and a fresh snapshot before applying anything. */

export type HashedRow = {
  sheet: string;
  row: number;
  key: string;
  classification: ReviewClassification;
  operation: ReviewOperation | null;
  targetPublicId: string | null;
  targetRevision: string | null;
  after: Record<string, string> | null;
  deferredFields: ReviewDeferredField[];
};

export type PlanHashInput = {
  engineVersion: string;
  tenantPublicId: string;
  brandPublicId: string;
  sourceNamespace: string;
  sourceProfile: string;
  fileFingerprint: string;
  sourceFileSha256: string | null;
  createdBySubject: string;
  createdByRole: string;
  reviewedBySubject: string;
  branchScope: "all" | string[];
  snapshotHash: string;
  rows: HashedRow[];
  decisions: PlanDecision[];
};

/** JSON with object keys sorted at every level, so equal content always hashes equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function sortedRows(rows: HashedRow[]) {
  return [...rows]
    .sort((a, b) => (a.sheet < b.sheet ? -1 : a.sheet > b.sheet ? 1 : a.row - b.row))
    .map((row) => ({
      sheet: row.sheet,
      row: row.row,
      key: row.key,
      classification: row.classification,
      operation: row.operation,
      targetPublicId: row.targetPublicId,
      targetRevision: row.targetRevision,
      after: row.after,
      deferredFields: row.deferredFields,
    }));
}

/** Decisions in a canonical order, independent of the order the operator made them. */
export function canonicalDecisions(decisions: PlanDecision[]) {
  return decisions.map((decision) => stableStringify(decision)).sort();
}

export function rowsDigest(rows: HashedRow[]) {
  return sha256(stableStringify(sortedRows(rows)));
}

export function planHash(input: PlanHashInput) {
  return sha256(
    stableStringify({
      v: input.engineVersion,
      tenantPublicId: input.tenantPublicId,
      brandPublicId: input.brandPublicId,
      sourceNamespace: input.sourceNamespace,
      sourceProfile: input.sourceProfile,
      fileFingerprint: input.fileFingerprint,
      sourceFileSha256: input.sourceFileSha256,
      actor: input.createdBySubject,
      role: input.createdByRole,
      reviewedBy: input.reviewedBySubject,
      branchScope: input.branchScope === "all" ? "all" : [...input.branchScope].sort(),
      snapshotHash: input.snapshotHash,
      rows: sortedRows(input.rows),
      decisions: canonicalDecisions(input.decisions),
    }),
  );
}
