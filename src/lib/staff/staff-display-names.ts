import { and, eq, inArray } from "drizzle-orm";

import { staffAuthUsers, staffIdentities, staffMemberships } from "@/db/schema";
import type { TenantDbExecutor } from "@/lib/tenant/context";

/**
 * Display names for staff subjects recorded on tenant records (publishers,
 * actors). Only subjects that hold a membership in this tenant resolve, so a
 * name never leaks across businesses; others are simply absent from the map.
 * Falls back to the identity email when the auth profile has no name.
 */
export async function resolveStaffDisplayNames(
  tx: TenantDbExecutor,
  tenantId: string,
  subjects: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(subjects.filter(Boolean))];
  if (unique.length === 0) {
    return new Map();
  }

  const rows = await tx
    .select({
      subject: staffIdentities.providerSubject,
      email: staffIdentities.email,
      name: staffAuthUsers.name,
    })
    .from(staffIdentities)
    .innerJoin(
      staffMemberships,
      and(
        eq(staffMemberships.staffIdentityId, staffIdentities.id),
        eq(staffMemberships.tenantId, tenantId),
      ),
    )
    .leftJoin(staffAuthUsers, eq(staffAuthUsers.id, staffIdentities.providerSubject))
    .where(inArray(staffIdentities.providerSubject, unique));

  return new Map(
    rows.map((row) => [row.subject, row.name?.trim() || row.email] as const),
  );
}
