import { and, asc, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryWarehouseRecord,
  inventoryWarehouses,
  type LocationRecord,
  locations,
  staffLocationScopes,
} from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { type Dependency, InventoryConflictError, InventoryDependencyError, InventoryError } from "@/lib/inventory/errors";
import {
  asBody,
  parseExpectedVersion,
  parseOptionalName,
  parseOptionalText,
  parseRecordCode,
  parseRequiredName,
  parseStatus,
  requireInventoryAdministrator,
  shortRandomHex,
  slugify,
  uniqueViolationConstraint,
  versionConflict,
} from "@/lib/inventory/shared";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { ALL_BRANCHES } from "@/lib/staff/branch-selection";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-196 branch warehouses. A warehouse belongs to exactly one active
   location (branch) of its tenant, chosen on create and never changed: stock
   history (QOS-201) is kept per warehouse, so moving one to another branch
   would rewrite where past stock was. All Branches is a read view, not a
   location, and the business branch labels are never locations, so neither
   can hold a warehouse. At most one active warehouse exists per branch. The
   location row is only read (share-locked on create), never written. */

export const WAREHOUSE_NAME_MAX_LENGTH = 120;
export const WAREHOUSE_NOTES_MAX_LENGTH = 400;

export type WarehouseBranchView = {
  publicId: string;
  name: string;
  status: LocationRecord["status"];
  timezone: string;
};

export type WarehouseView = {
  publicId: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  notes: string | null;
  status: InventoryWarehouseRecord["status"];
  version: number;
  provenance: InventoryWarehouseRecord["provenance"];
  branch: WarehouseBranchView;
  createdAt: string;
  updatedAt: string;
};

export type WarehouseDetailView = {
  warehouse: WarehouseView;
  /** Stock records that would block archiving or reassigning the warehouse. */
  dependencies: Dependency[];
};

type WarehouseRow = { warehouse: InventoryWarehouseRecord; location: LocationRecord };

function toWarehouseView({ warehouse, location }: WarehouseRow): WarehouseView {
  return {
    publicId: warehouse.publicId,
    code: warehouse.code,
    nameEn: warehouse.nameEn,
    nameAr: warehouse.nameAr,
    notes: warehouse.notes,
    status: warehouse.status,
    version: warehouse.version,
    provenance: warehouse.provenance,
    branch: { publicId: location.publicId, name: location.name, status: location.status, timezone: location.timezone },
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}

/**
 * Records that depend on the warehouse. Nothing does yet: QOS-201 adds stock
 * movement and stock operation counts here and QOS-208 adds prep targets.
 * Archive and reassignment both report this list.
 */
export async function warehouseDependencies(tx: DbClient, tenantId: string, warehouseId: string): Promise<Dependency[]> {
  void tx;
  void tenantId;
  void warehouseId;
  return [];
}

function warehouseQuery(tx: DbClient, tenantId: string) {
  return tx
    .select({ warehouse: inventoryWarehouses, location: locations })
    .from(inventoryWarehouses)
    .innerJoin(
      locations,
      and(eq(locations.tenantId, inventoryWarehouses.tenantId), eq(locations.id, inventoryWarehouses.locationId)),
    )
    .where(eq(inventoryWarehouses.tenantId, tenantId));
}

async function hasLocationScope(tx: DbClient, tenantId: string, membership: ActiveStaffMembership, locationId: string) {
  const [scope] = await tx
    .select({ id: staffLocationScopes.id })
    .from(staffLocationScopes)
    .where(
      and(
        eq(staffLocationScopes.tenantId, tenantId),
        eq(staffLocationScopes.staffMembershipId, membership.membershipId),
        eq(staffLocationScopes.locationId, locationId),
      ),
    )
    .limit(1);
  return Boolean(scope);
}

async function loadWarehouseInTx(
  tx: DbClient,
  tenantId: string,
  warehousePublicId: unknown,
  lock?: "update",
): Promise<WarehouseRow> {
  if (typeof warehousePublicId !== "string" || !warehousePublicId) {
    throw new InventoryError("Warehouse not found.", 404, "warehouse_not_found", "warehousePublicId");
  }
  const query = tx
    .select()
    .from(inventoryWarehouses)
    .where(and(eq(inventoryWarehouses.tenantId, tenantId), eq(inventoryWarehouses.publicId, warehousePublicId)))
    .limit(1);
  const [warehouse] = lock ? await query.for(lock) : await query;
  if (!warehouse) {
    throw new InventoryError("Warehouse not found.", 404, "warehouse_not_found", "warehousePublicId");
  }
  // Read only: the location row is never locked for update or written here.
  const [location] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, warehouse.locationId)))
    .limit(1);
  return { warehouse, location: location! };
}

/**
 * Resolves the branch a new warehouse belongs to: one existing, active
 * location of this tenant. All Branches, a blank value or a business label
 * is not a location; another tenant's location is not found (RLS hides it).
 */
async function resolveActiveLocationInTx(tx: DbClient, tenantId: string, value: unknown): Promise<LocationRecord> {
  if (typeof value !== "string" || !value.trim() || value === ALL_BRANCHES) {
    throw new InventoryError(
      "Choose one branch. All branches cannot hold a warehouse.",
      400,
      "location_required",
      "locationPublicId",
    );
  }
  const [location] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.publicId, value)))
    .limit(1)
    .for("share");
  if (!location) {
    throw new InventoryError("Branch not found.", 404, "location_not_found", "locationPublicId");
  }
  if (location.status !== "active") {
    throw new InventoryError(
      "This branch is suspended and cannot take a new warehouse.",
      400,
      "location_suspended",
      "locationPublicId",
    );
  }
  return location;
}

function mapWarehouseWriteError(error: unknown): never {
  const constraint = uniqueViolationConstraint(error);
  if (constraint === "inventory_warehouses_active_location_unique") {
    throw new InventoryConflictError(
      "This branch already has an active warehouse.",
      "warehouse_branch_taken",
      "locationPublicId",
    );
  }
  if (constraint === "inventory_warehouses_tenant_code_unique") {
    throw new InventoryConflictError("Another warehouse already uses this code.", "warehouse_code_taken", "code");
  }
  throw error;
}

function generateWarehousePublicId(code: string) {
  return `wh_${slugify(code, "warehouse")}_${shortRandomHex(8)}`;
}

function auditWarehouse({ warehouse, location }: WarehouseRow) {
  return {
    code: warehouse.code,
    nameEn: warehouse.nameEn,
    nameAr: warehouse.nameAr,
    notes: warehouse.notes,
    status: warehouse.status,
    branch: location.publicId,
  };
}

async function detailInTx(tx: DbClient, tenantId: string, row: WarehouseRow): Promise<WarehouseDetailView> {
  return { warehouse: toWarehouseView(row), dependencies: await warehouseDependencies(tx, tenantId, row.warehouse.id) };
}

/** Administrators see every warehouse; users only those at branches in their location scope. */
export async function listWarehouses(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
): Promise<{ warehouses: WarehouseView[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const order = [asc(inventoryWarehouses.status), asc(inventoryWarehouses.nameEn), asc(inventoryWarehouses.publicId)];
    const rows =
      membership.role === "administrator"
        ? await warehouseQuery(tx, tenantId).orderBy(...order)
        : await tx
            .select({ warehouse: inventoryWarehouses, location: locations })
            .from(inventoryWarehouses)
            .innerJoin(
              locations,
              and(eq(locations.tenantId, inventoryWarehouses.tenantId), eq(locations.id, inventoryWarehouses.locationId)),
            )
            .innerJoin(
              staffLocationScopes,
              and(
                eq(staffLocationScopes.tenantId, inventoryWarehouses.tenantId),
                eq(staffLocationScopes.locationId, inventoryWarehouses.locationId),
                eq(staffLocationScopes.staffMembershipId, membership.membershipId),
              ),
            )
            .where(eq(inventoryWarehouses.tenantId, tenantId))
            .orderBy(...order);
    return { warehouses: rows.map(toWarehouseView) };
  });
}

export async function getWarehouse(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  warehousePublicId: string,
): Promise<WarehouseDetailView> {
  return withTenantContext(db, tenantId, async (tx) => {
    const row = await loadWarehouseInTx(tx, tenantId, warehousePublicId);
    if (membership.role !== "administrator" && !(await hasLocationScope(tx, tenantId, membership, row.location.id))) {
      throw new InventoryError("Your membership does not include this branch.", 403, "branch_not_permitted", "warehousePublicId");
    }
    return detailInTx(tx, tenantId, row);
  });
}

export async function createWarehouse(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
): Promise<WarehouseDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const code = parseRecordCode(body.code, "code");
  const nameEn = parseRequiredName(body.nameEn, "nameEn", WAREHOUSE_NAME_MAX_LENGTH);
  const nameAr = parseOptionalName(body.nameAr, "nameAr", WAREHOUSE_NAME_MAX_LENGTH);
  const notes = parseOptionalText(body.notes, "notes", WAREHOUSE_NOTES_MAX_LENGTH);
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const location = await resolveActiveLocationInTx(tx, tenantId, body.locationPublicId);
      const [warehouse] = await tx
        .insert(inventoryWarehouses)
        .values({
          tenantId,
          publicId: generateWarehousePublicId(code),
          locationId: location.id,
          code,
          nameEn,
          nameAr,
          notes,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      const row = { warehouse: warehouse!, location };
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        locationId: location.id,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "inventory.warehouse.create",
        entityType: "inventory_warehouse",
        entityPublicId: warehouse!.publicId,
        entityVersion: warehouse!.version,
        changeSummary: { after: auditWarehouse(row) },
      });
      return detailInTx(tx, tenantId, row);
    });
  } catch (error) {
    return mapWarehouseWriteError(error);
  }
}

export async function updateWarehouse(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  warehousePublicId: string,
  input: unknown,
): Promise<WarehouseDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const nameEn = body.nameEn === undefined ? undefined : parseRequiredName(body.nameEn, "nameEn", WAREHOUSE_NAME_MAX_LENGTH);
  const nameAr = body.nameAr === undefined ? undefined : parseOptionalName(body.nameAr, "nameAr", WAREHOUSE_NAME_MAX_LENGTH);
  const notes = body.notes === undefined ? undefined : parseOptionalText(body.notes, "notes", WAREHOUSE_NOTES_MAX_LENGTH);
  const status = parseStatus(body.status);
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const current = await loadWarehouseInTx(tx, tenantId, warehousePublicId, "update");
      if (current.warehouse.version !== expectedVersion) {
        throw versionConflict();
      }
      if (body.locationPublicId !== undefined && body.locationPublicId !== current.location.publicId) {
        throw new InventoryDependencyError(
          "A warehouse stays with its branch so stock history remains traceable. Archive it and add a warehouse at the other branch.",
          "location_immutable",
          "locationPublicId",
          await warehouseDependencies(tx, tenantId, current.warehouse.id),
        );
      }
      if (body.code !== undefined && body.code !== current.warehouse.code) {
        throw new InventoryError(
          "The code cannot change after the warehouse is created. Rename the warehouse instead.",
          400,
          "warehouse_code_immutable",
          "code",
        );
      }
      const nextStatus = status ?? current.warehouse.status;
      if (nextStatus === "archived" && current.warehouse.status !== "archived") {
        const dependencies = await warehouseDependencies(tx, tenantId, current.warehouse.id);
        if (dependencies.length > 0) {
          throw new InventoryDependencyError(
            "This warehouse has stock history and cannot be archived.",
            "warehouse_in_use",
            "status",
            dependencies,
          );
        }
      }
      const [warehouse] = await tx
        .update(inventoryWarehouses)
        .set({
          nameEn: nameEn ?? current.warehouse.nameEn,
          nameAr: nameAr === undefined ? current.warehouse.nameAr : nameAr,
          notes: notes === undefined ? current.warehouse.notes : notes,
          status: nextStatus,
          version: current.warehouse.version + 1,
          updatedAt: new Date(),
          updatedBySubject: actorSubject,
        })
        .where(and(eq(inventoryWarehouses.id, current.warehouse.id), eq(inventoryWarehouses.version, expectedVersion)))
        .returning();
      if (!warehouse) {
        throw versionConflict();
      }
      const updated = { warehouse, location: current.location };
      const action =
        nextStatus !== current.warehouse.status
          ? nextStatus === "archived"
            ? "inventory.warehouse.archive"
            : "inventory.warehouse.restore"
          : "inventory.warehouse.update";
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        locationId: current.location.id,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action,
        entityType: "inventory_warehouse",
        entityPublicId: warehouse.publicId,
        entityVersion: warehouse.version,
        changeSummary: { before: auditWarehouse(current), after: auditWarehouse(updated) },
      });
      return detailInTx(tx, tenantId, updated);
    });
  } catch (error) {
    return mapWarehouseWriteError(error);
  }
}
