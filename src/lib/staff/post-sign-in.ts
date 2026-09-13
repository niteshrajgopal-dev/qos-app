import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";

export function resolveStaffDestinationAfterSignIn(
  memberships: readonly ActiveStaffMembershipSummary[],
) {
  if (memberships.length === 1) {
    return `/tenants/${memberships[0].tenantId}`;
  }

  return "/staff/businesses";
}
