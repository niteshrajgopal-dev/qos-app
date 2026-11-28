import type { DbClient } from "@/db/client";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { resolveStaffDisplayNames } from "@/lib/staff/staff-display-names";
import { withTenantContext } from "@/lib/tenant/context";
import { WorkbookApplyError } from "@/lib/workbook/apply/errors";
import type { ApplyHistoryEntry } from "@/lib/workbook/apply/model";
import { EMPTY_COUNTS, listRecentApplyRecords } from "@/lib/workbook/apply/repository";

/* Past workbook applies of the tenant (QOS-200 follow-up), for the import
   page after it is reopened. Read only, inside the tenant context (RLS).
   Administrators only, the same rule as apply. Actors are shown by their
   name in this business, never by raw subject. Per-row results stay on the
   plan (`GET …/plans/{planPublicId}`). */

export const APPLY_HISTORY_DEFAULT_LIMIT = 20;
export const APPLY_HISTORY_MAX_LIMIT = 50;

/** `?limit=` as a whole number from 1 to 50; anything else is the default. */
export function parseHistoryLimit(raw: string | null) {
  if (raw === null || !/^\d+$/.test(raw.trim())) return APPLY_HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.max(Number(raw.trim()), 1), APPLY_HISTORY_MAX_LIMIT);
}

export async function listRecentApplies(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  options: { limit?: number } = {},
): Promise<{ applies: ApplyHistoryEntry[] }> {
  if (membership.role !== "administrator") {
    throw new WorkbookApplyError("apply_requires_administrator", "Only an administrator can see workbook applies.", 403);
  }
  const limit = Math.min(Math.max(options.limit ?? APPLY_HISTORY_DEFAULT_LIMIT, 1), APPLY_HISTORY_MAX_LIMIT);
  return withTenantContext(db, tenantId, async (tx) => {
    const records = await listRecentApplyRecords(tx, tenantId, limit);
    const names = await resolveStaffDisplayNames(tx, tenantId, records.map((record) => record.apply.actorSubject));
    return {
      applies: records.map(({ apply, planPublicId, fileName, sourceProfile, templateVersion }) => ({
        publicId: apply.publicId,
        status: apply.status,
        planPublicId,
        fileName,
        sourceProfile,
        templateVersion,
        planRevision: apply.planRevision,
        actorDisplayName: names.get(apply.actorSubject) ?? null,
        actorRole: apply.actorRole,
        startedAt: apply.startedAt.toISOString(),
        finishedAt: apply.finishedAt ? apply.finishedAt.toISOString() : null,
        counts: { ...EMPTY_COUNTS, ...apply.counts },
      })),
    };
  });
}
