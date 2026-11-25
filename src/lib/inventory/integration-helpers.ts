import type { resetAndMigrate } from "@/db/test-utils";
import type { ActiveStaffMembership } from "@/lib/staff/auth";

/* Shared setup for the QOS-195, QOS-196, QOS-197 and QOS-198 service integration tests. */

export type IntegrationConnection = Awaited<ReturnType<typeof resetAndMigrate>>;

export const ADMIN: ActiveStaffMembership = { membershipId: "seed-admin", role: "administrator", staffIdentityId: "seed-admin" };
export const USER: ActiveStaffMembership = { membershipId: "seed-user", role: "user", staffIdentityId: "seed-user" };
export const ACTOR = "admin.qos195@test";

export async function truncateInventory(sql: IntegrationConnection["sql"]) {
  await sql`TRUNCATE TABLE qos.tenant_audit_events, qos.recipe_sellable_links, qos.recipe_version_snapshots, qos.recipe_version_steps, qos.recipe_version_lines, qos.recipe_versions, qos.recipes, qos.inventory_item_reference_costs, qos.inventory_item_conversions, qos.inventory_items, qos.inventory_categories, qos.inventory_units, qos.inventory_warehouses, qos.inventory_suppliers, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
}

export async function auditActions(sql: IntegrationConnection["sql"], tenantId: string) {
  const rows = await sql<
    { action: string; entity_type: string; entity_public_id: string; location_id: string | null; change_summary: Record<string, unknown> }[]
  >`
    SELECT action, entity_type, entity_public_id, location_id, change_summary FROM qos.tenant_audit_events
    WHERE tenant_id = ${tenantId} ORDER BY occurred_at, id`;
  return rows;
}

export async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const typed = error as { statusCode?: number; code?: string; field?: string };
    return { statusCode: typed.statusCode, code: typed.code, field: typed.field };
  }
  throw new Error("expected the call to be rejected");
}
