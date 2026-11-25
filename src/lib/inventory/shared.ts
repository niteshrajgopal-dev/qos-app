import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  type InventoryCategoryRecord,
  type InventorySupplierRecord,
  type InventoryUnitRecord,
  inventoryCategories,
  inventorySuppliers,
  inventoryUnits,
  tenants,
} from "@/db/schema";
import { calendarDateInTimeZone, isCalendarDate } from "@/lib/catalogue/selling-tax-cost";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import type { ActiveStaffMembership } from "@/lib/staff/auth";

/* Helpers shared by the QOS-195 unit, item and conversion services, the
   QOS-196 supplier and warehouse services and the QOS-197 category and
   reference-cost services. */

/** Units, items, categories, costs, conversions, suppliers and warehouses are master data that feed costing (D14 assumption). */
export function requireInventoryAdministrator(membership: ActiveStaffMembership) {
  if (membership.role !== "administrator") {
    throw new InventoryError(
      "Only administrators can change inventory setup records.",
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

/* QOS-196 field parsers. `null`, an omitted value or a blank string all mean
   "no value"; text is trimmed before its length is checked. */

/** Supplier and warehouse reference codes: case kept, compared case-insensitively. */
export const RECORD_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/;

export function parseOptionalText(value: unknown, field: string, max: number, code = "text_too_long"): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new InventoryError("Enter this value as text.", 400, "body_invalid", field);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > max) {
    throw new InventoryError(`This text can be at most ${max} characters.`, 400, code, field);
  }
  return trimmed;
}

export function parseRecordCode(value: unknown, field = "code"): string {
  const code = typeof value === "string" ? value.trim() : "";
  if (!RECORD_CODE_PATTERN.test(code)) {
    throw new InventoryError(
      "Use 1 to 24 letters, digits, hyphens or underscores for the code, starting with a letter or digit.",
      400,
      "code_invalid",
      field,
    );
  }
  return code;
}

export function parseOptionalCode(value: unknown, field = "code"): string | null {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return null;
  }
  return parseRecordCode(value, field);
}

const PHONE_PATTERN = /^[0-9 +()-]+$/;

export function parsePhone(value: unknown, field = "phone"): string | null {
  const phone = parseOptionalText(value, field, 40);
  if (phone === null) {
    return null;
  }
  if (!PHONE_PATTERN.test(phone) || !/[0-9]/.test(phone)) {
    throw new InventoryError(
      "Enter the phone number with digits, spaces, plus or hyphens only.",
      400,
      "phone_invalid",
      field,
    );
  }
  return phone;
}

/** Format check only: one @ with a dot in the domain and no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(value: unknown, field = "email"): string | null {
  const email = parseOptionalText(value, field, 254);
  if (email === null) {
    return null;
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new InventoryError("Enter a valid email address.", 400, "email_invalid", field);
  }
  return email;
}

export type SupplierView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  code: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: InventorySupplierRecord["status"];
  version: number;
  provenance: InventorySupplierRecord["provenance"];
  createdAt: string;
  updatedAt: string;
};

export function toSupplierView(row: InventorySupplierRecord): SupplierView {
  return {
    publicId: row.publicId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    code: row.code,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    status: row.status,
    version: row.version,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadSupplierByPublicIdInTx(
  tx: DbClient,
  tenantId: string,
  publicId: unknown,
  field = "supplierPublicId",
  lock: "share" | "update" = "share",
): Promise<InventorySupplierRecord> {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Supplier not found.", 404, "supplier_not_found", field);
  }
  // Same locking rule as units: referencing writers share-lock, archive
  // update-locks, so a supplier cannot be archived while a new item default commits.
  const [row] = await tx
    .select()
    .from(inventorySuppliers)
    .where(and(eq(inventorySuppliers.tenantId, tenantId), eq(inventorySuppliers.publicId, publicId)))
    .limit(1)
    .for(lock);
  if (!row) {
    throw new InventoryError("Supplier not found.", 404, "supplier_not_found", field);
  }
  return row;
}

/* QOS-197 inventory categories. */

export const ITEM_NOTES_MAX_LENGTH = 1000;

/** Item notes: same rules and limit as supplier notes. */
export function parseOptionalNotes(value: unknown, field = "notes"): string | null {
  return parseOptionalText(value, field, ITEM_NOTES_MAX_LENGTH);
}

export type CategoryView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  status: InventoryCategoryRecord["status"];
  version: number;
  provenance: InventoryCategoryRecord["provenance"];
  createdAt: string;
  updatedAt: string;
};

export function toCategoryView(row: InventoryCategoryRecord): CategoryView {
  return {
    publicId: row.publicId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    status: row.status,
    version: row.version,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadTenantCategoriesInTx(tx: DbClient, tenantId: string): Promise<InventoryCategoryRecord[]> {
  return tx
    .select()
    .from(inventoryCategories)
    .where(eq(inventoryCategories.tenantId, tenantId))
    .orderBy(asc(inventoryCategories.nameEn), asc(inventoryCategories.publicId));
}

export async function loadCategoryByPublicIdInTx(
  tx: DbClient,
  tenantId: string,
  publicId: unknown,
  field = "categoryPublicId",
  lock: "share" | "update" = "share",
): Promise<InventoryCategoryRecord> {
  if (typeof publicId !== "string" || !publicId) {
    throw new InventoryError("Category not found.", 404, "category_not_found", field);
  }
  // Same locking rule as units and suppliers: item writers share-lock,
  // archive update-locks, so a category cannot be archived while a new item
  // assignment commits.
  const [row] = await tx
    .select()
    .from(inventoryCategories)
    .where(and(eq(inventoryCategories.tenantId, tenantId), eq(inventoryCategories.publicId, publicId)))
    .limit(1)
    .for(lock);
  if (!row) {
    throw new InventoryError("Category not found.", 404, "category_not_found", field);
  }
  return row;
}
