import { and, eq, inArray } from "drizzle-orm";

import { staffIdentities, staffMemberships } from "@/db/schema";
import type { TenantDbExecutor } from "@/lib/tenant/context";

/**
 * Resolves staff provider subjects to tenant-scoped display labels (email).
 * Subjects without an active membership in this tenant are omitted.
 */
export async function resolveStaffDisplayNamesInTenant(
  tx: TenantDbExecutor,
  tenantId: string,
  subjects: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(subjects.filter((subject) => subject.length > 0))];
  if (unique.length === 0) {
    return new Map();
  }

  const rows = await tx
    .select({
      providerSubject: staffIdentities.providerSubject,
      email: staffIdentities.email,
    })
    .from(staffIdentities)
    .innerJoin(
      staffMemberships,
      eq(staffMemberships.staffIdentityId, staffIdentities.id),
    )
    .where(
      and(
        eq(staffMemberships.tenantId, tenantId),
        eq(staffMemberships.status, "active"),
        inArray(staffIdentities.providerSubject, unique),
      ),
    );

  return new Map(rows.map((row) => [row.providerSubject, row.email]));
}
