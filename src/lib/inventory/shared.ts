import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import { type InventoryUnitRecord, inventoryUnits, tenants } from "@/db/schema";
import { calendarDateInTimeZone, isCalendarDate } from "@/lib/catalogue/selling-tax-cost";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import type { ActiveStaffMembership } from "@/lib/staff/auth";

/* Helpers shared by the QOS-195 unit, item and conversion services. */

/** Units, items and conversions are tenant-wide master data that feed costing (D14 assumption). */
export function requireInventoryAdministrator(membership: ActiveStaffMembership) {
  if (membership.role !== "administrator") {
    throw new InventoryError(
      "Only administrators can change units, items and conversions.",
      403,
      "administrator_required",
    );
  }
}

export function uniqueViolationConstraint(error: unknown): string | null {
  const candidate = error as {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  } | null;
  if (candidate?.code === "23505") {
    return candidate.constraint_name ?? "";
  }
  if (candidate?.cause?.code === "23505") {
    return candidate.cause.constraint_name ?? "";
  }
  return null;
}

export async function tenantToday(tx: DbClient, tenantId: string, now: Date = new Date()) {
  const [tenant] = await tx
    .select({ defaultTimezone: tenants.defaultTimezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return calendarDateInTimeZone(now, tenant?.defaultTimezone ?? "UTC");
}

export function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function shortRandomHex(length: number) {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

export function parseExpectedVersion(value: unknown, field = "expectedVersion"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new InventoryError(`${field} is required.`, 400, "expected_version_required", field);
  }
  return value;
}

export function versionConflict(field = "expectedVersion"): InventoryConflictError {
  return new InventoryConflictError(
    "This record changed elsewhere. Reload and try again.",
    "expected_version_mismatch",
    field,
  );
}

export function parseRequiredName(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InventoryError("Enter a name.", 400, "name_required", field);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new InventoryError(`Names can be at most ${max} characters.`, 400, "name_too_long", field);
  }
  return trimmed;
}

export function parseOptionalName(value: unknown, field: string, max: number): string | null {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return null;
  }
  return parseRequiredName(value, field, max);
}

export function parseOptionalDate(value: unknown, field = "effectiveFrom"): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (!isCalendarDate(value)) {
    throw new InventoryError("Enter a date as YYYY-MM-DD.", 400, "effective_from_invalid", field);
  }
  return value;
}

export function parseStatus(value: unknown): "active" | "archived" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "active" && value !== "archived") {
    throw new InventoryError("Status must be active or archived.", 400, "status_invalid", "status");
  }
  return value;
}

export function asBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InventoryError("The request body must be a JSON object.", 400, "body_invalid");
  }
  return input as Record<string, unknown>;
}

export type UnitView = {
  publicId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  quantityKind: InventoryUnitRecord["quantityKind"];
  standardCode: InventoryUnitRecord["standardCode"];
  decimalPlaces: number;
  status: InventoryUnitRecord["status"];
  version: number;
  provenance: InventoryUnitRecord["provenance"];
  createdAt: string;
  updatedAt: string;
};

export function toUnitView(row: InventoryUnitRecord): UnitView {
  return {
    publicId: row.publicId,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    quantityKind: row.quantityKind,
    standardCode: row.standardCode,
    decimalPlaces: row.decimalPlaces,
    status: row.status,
    version: row.version,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadTenantUnitsInTx(tx: DbClient, tenantId: string): Promise<InventoryUnitRecord[]> {
  return tx
    .select()
    .from(inventoryUnits)
    .where(eq(inventoryUnits.tenantId, tenantId))
    .orderBy(asc(inventoryUnits.code));
}

export async function loadUnitByPublicIdInTx(
  tx: DbClient,
  tenantId: string,
  publicId: unknown,
  field = "unitPublicId",
  lock: "share" | "update" = "share",
): Promise<InventoryUnitRecord> {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Unit not found.", 404, "unit_not_found", field);
  }
  // Writers that reference a unit take a share lock and archive takes an
  // update lock, so a unit cannot be archived while a new reference commits.
  const [row] = await tx
    .select()
    .from(inventoryUnits)
    .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.publicId, publicId)))
    .limit(1)
    .for(lock);
  if (!row) {
    throw new InventoryError("Unit not found.", 404, "unit_not_found", field);
  }
  return row;
}
