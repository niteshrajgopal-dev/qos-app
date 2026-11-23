import { and, asc, count, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { type InventorySupplierRecord, inventoryItems, inventorySuppliers } from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { type Dependency, InventoryConflictError, InventoryDependencyError, InventoryError } from "@/lib/inventory/errors";
import {
  asBody,
  loadSupplierByPublicIdInTx,
  parseEmail,
  parseExpectedVersion,
  parseOptionalCode,
  parseOptionalName,
  parseOptionalText,
  parsePhone,
  parseRequiredName,
  parseStatus,
  requireInventoryAdministrator,
  shortRandomHex,
  slugify,
  type SupplierView,
  toSupplierView,
  uniqueViolationConstraint,
  versionConflict,
} from "@/lib/inventory/shared";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-196 suppliers: basic identity, contact and reference details. A
   supplier's identity is its public id; names are not unique, so two
   suppliers called the same thing stay two suppliers. The optional reference
   code is unique per tenant (case-insensitive) and editable because nothing
   snapshots it yet. Suppliers are never deleted; archiving is refused while an
   active item uses the supplier as its default. No payment terms, invoices or
   payables are recorded here. */

export const SUPPLIER_NAME_MAX_LENGTH = 120;

export type SupplierItemView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: "purchased" | "prepared";
  status: "active" | "archived";
};

export type SupplierDetailView = {
  supplier: SupplierView;
  /** Items (active and archived) whose default supplier is this supplier. */
  items: SupplierItemView[];
  /** What would block archiving right now. */
  dependencies: Dependency[];
};

type SupplierFields = {
  nameEn: string;
  nameAr: string | null;
  code: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

const OPTIONAL_FIELDS = ["nameAr", "code", "contactName", "phone", "email", "address", "notes"] as const;

/** Parses the fields present in `body`; omitted fields are left out of the result. */
export function parseSupplierFields(body: Record<string, unknown>, requireName: boolean): Partial<SupplierFields> {
  const result: Partial<SupplierFields> = {};
  if (requireName || body.nameEn !== undefined) {
    result.nameEn = parseRequiredName(body.nameEn, "nameEn", SUPPLIER_NAME_MAX_LENGTH);
  }
  const parsers: Record<(typeof OPTIONAL_FIELDS)[number], (value: unknown) => string | null> = {
    nameAr: (value) => parseOptionalName(value, "nameAr", SUPPLIER_NAME_MAX_LENGTH),
    code: (value) => parseOptionalCode(value, "code"),
    contactName: (value) => parseOptionalText(value, "contactName", 120),
    phone: (value) => parsePhone(value, "phone"),
    email: (value) => parseEmail(value, "email"),
    address: (value) => parseOptionalText(value, "address", 400),
    notes: (value) => parseOptionalText(value, "notes", 1000),
  };
  for (const field of OPTIONAL_FIELDS) {
    if (body[field] !== undefined) {
      result[field] = parsers[field](body[field]);
    }
  }
  return result;
}

function mapSupplierWriteError(error: unknown): never {
  if (uniqueViolationConstraint(error) === "inventory_suppliers_tenant_code_unique") {
    throw new InventoryConflictError("Another supplier already uses this reference code.", "supplier_code_taken", "code");
  }
  throw error;
}

function generateSupplierPublicId(nameEn: string) {
  return `sup_${slugify(nameEn, "supplier")}_${shortRandomHex(8)}`;
}

function auditSupplier(row: InventorySupplierRecord) {
  return {
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    code: row.code,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    status: row.status,
  };
}

/**
 * Records that would block archiving the supplier. Only active items count:
 * an archived item keeps its default as history. QOS-202 adds direct
 * receipts here.
 */
export async function supplierDependencies(tx: DbClient, tenantId: string, supplierId: string): Promise<Dependency[]> {
  const [items] = await tx
    .select({ value: count() })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.defaultSupplierId, supplierId),
        eq(inventoryItems.status, "active"),
      ),
    );
  const itemCount = items?.value ?? 0;
  return itemCount > 0 ? [{ kind: "inventory_items", count: itemCount }] : [];
}

async function loadSupplierDetailInTx(
  tx: DbClient,
  tenantId: string,
  supplier: InventorySupplierRecord,
): Promise<SupplierDetailView> {
  const items = await tx
    .select({
      publicId: inventoryItems.publicId,
      nameEn: inventoryItems.nameEn,
      nameAr: inventoryItems.nameAr,
      kind: inventoryItems.kind,
      status: inventoryItems.status,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.defaultSupplierId, supplier.id)))
    .orderBy(asc(inventoryItems.nameEn), asc(inventoryItems.publicId));
  return {
    supplier: toSupplierView(supplier),
    items,
    dependencies: await supplierDependencies(tx, tenantId, supplier.id),
  };
}

export async function listSuppliers(db: DbClient, tenantId: string): Promise<{ suppliers: SupplierView[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(inventorySuppliers)
      .where(eq(inventorySuppliers.tenantId, tenantId))
      .orderBy(asc(inventorySuppliers.nameEn), asc(inventorySuppliers.publicId));
    return { suppliers: rows.map(toSupplierView) };
  });
}

export async function getSupplier(db: DbClient, tenantId: string, supplierPublicId: string): Promise<SupplierDetailView> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [supplier] = await tx
      .select()
      .from(inventorySuppliers)
      .where(and(eq(inventorySuppliers.tenantId, tenantId), eq(inventorySuppliers.publicId, supplierPublicId)))
      .limit(1);
    if (!supplier) {
      throw new InventoryError("Supplier not found.", 404, "supplier_not_found", "supplierPublicId");
    }
    return loadSupplierDetailInTx(tx, tenantId, supplier);
  });
}

export async function createSupplier(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
): Promise<SupplierDetailView> {
  requireInventoryAdministrator(membership);
  const fields = parseSupplierFields(asBody(input), true) as Partial<SupplierFields> & { nameEn: string };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(inventorySuppliers)
        .values({
          tenantId,
          publicId: generateSupplierPublicId(fields.nameEn),
          nameEn: fields.nameEn,
          nameAr: fields.nameAr ?? null,
          code: fields.code ?? null,
          contactName: fields.contactName ?? null,
          phone: fields.phone ?? null,
          email: fields.email ?? null,
          address: fields.address ?? null,
          notes: fields.notes ?? null,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "inventory.supplier.create",
        entityType: "inventory_supplier",
        entityPublicId: row!.publicId,
        entityVersion: row!.version,
        changeSummary: { after: auditSupplier(row!) },
      });
      return loadSupplierDetailInTx(tx, tenantId, row!);
    });
  } catch (error) {
    return mapSupplierWriteError(error);
  }
}

export async function updateSupplier(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  supplierPublicId: string,
  input: unknown,
): Promise<SupplierDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const fields = parseSupplierFields(body, false);
  const status = parseStatus(body.status);
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const supplier = await loadSupplierByPublicIdInTx(tx, tenantId, supplierPublicId, "supplierPublicId", "update");
      if (supplier.version !== expectedVersion) {
        throw versionConflict();
      }
      const nextStatus = status ?? supplier.status;
      if (nextStatus === "archived" && supplier.status !== "archived") {
        const dependencies = await supplierDependencies(tx, tenantId, supplier.id);
        if (dependencies.length > 0) {
          throw new InventoryDependencyError(
            "Items still use this supplier as their default. Clear it on those items first.",
            "supplier_in_use",
            "status",
            dependencies,
          );
        }
      }
      const [updated] = await tx
        .update(inventorySuppliers)
        .set({
          ...fields,
          status: nextStatus,
          version: supplier.version + 1,
          updatedAt: new Date(),
          updatedBySubject: actorSubject,
        })
        .where(and(eq(inventorySuppliers.id, supplier.id), eq(inventorySuppliers.version, expectedVersion)))
        .returning();
      if (!updated) {
        throw versionConflict();
      }
      const action =
        nextStatus !== supplier.status
          ? nextStatus === "archived"
            ? "inventory.supplier.archive"
            : "inventory.supplier.restore"
          : "inventory.supplier.update";
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action,
        entityType: "inventory_supplier",
        entityPublicId: updated.publicId,
        entityVersion: updated.version,
        changeSummary: { before: auditSupplier(supplier), after: auditSupplier(updated) },
      });
      return loadSupplierDetailInTx(tx, tenantId, updated);
    });
  } catch (error) {
    return mapSupplierWriteError(error);
  }
}
