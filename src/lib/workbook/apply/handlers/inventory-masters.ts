import { and, eq } from "drizzle-orm";

import { inventoryCategories, inventorySuppliers, inventoryUnits, inventoryWarehouses } from "@/db/schema";
import { createCategory, updateCategory } from "@/lib/inventory/categories";
import { createSupplier, updateSupplier } from "@/lib/inventory/suppliers";
import { createUnit, updateUnit } from "@/lib/inventory/units";
import { createWarehouse, updateWarehouse } from "@/lib/inventory/warehouses";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { int, present, proposedValues, requireTarget, resolveReference, text, type Values } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";
import { quantityKindOf, standardUnitOfRow } from "@/lib/workbook/phase2-values";

/* Inventory masters (QOS-200): units, suppliers, warehouses and inventory
   categories through the QOS-195/196/197 services, which recheck the
   administrator role and validate exactly as the inventory screens do. The
   `active` column is the status: FALSE archives, TRUE restores. Records are
   never deleted. */

/** `active` TRUE/FALSE as the services' status; absent when the row does not change it. */
export function activeStatus(values: Values): "active" | "archived" | undefined {
  const value = text(values, "active");
  return value === "TRUE" ? "active" : value === "FALSE" ? "archived" : undefined;
}

/** Fields the services accept as optional text: a cleared cell is null, an absent one is left out. */
function optionalFields(values: Values, mapping: Record<string, string>) {
  return Object.fromEntries(Object.entries(mapping).filter(([column]) => values.has(column)).map(([column, field]) => [field, text(values, column) ?? null]));
}

function refuseImmutable(values: Values, columns: string[]) {
  for (const column of columns) {
    if (values.has(column)) {
      throw new ApplyUnitError("service_validation", `${column} cannot change after the record is created.`, { field: column, reason: "immutable_field" });
    }
  }
}

async function lockedVersion(context: HandlerContext, table: typeof inventoryUnits | typeof inventorySuppliers | typeof inventoryWarehouses | typeof inventoryCategories, publicId: string) {
  const [row] = await context.tx
    .select({ version: table.version })
    .from(table)
    .where(and(eq(table.tenantId, context.run.tenantId), eq(table.publicId, publicId)))
    .limit(1)
    .for("update");
  if (!row) throw new ApplyUnitError("target_not_found", "The record this row changes no longer exists.");
  return row.version;
}

const UNIT_FIELDS = ["code", "name", "name_ar", "standard_code", "quantity_kind", "decimal_places", "active"];

/* Units: a standard unit (D11) or a custom unit with its code and Arabic name. */
export const applyUnits: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  if (row.operation === "create") {
    const after = row.after ?? {};
    const standard = standardUnitOfRow(after);
    const decimalPlaces = int(values, "decimal_places") ?? undefined;
    const input = standard
      ? {
          source: "standard" as const,
          standardCode: standard.code,
          ...(decimalPlaces !== undefined ? { decimalPlaces } : {}),
          // A name that only identified the standard keeps the QOS names.
          ...(standard.byName ? {} : { ...(after.name ? { nameEn: after.name } : {}), ...(after.name_ar ? { nameAr: after.name_ar } : {}) }),
        }
      : {
          source: "custom" as const,
          code: after.code ?? "",
          nameEn: after.name ?? "",
          nameAr: after.name_ar ?? "",
          quantityKind: quantityKindOf(after.quantity_kind) ?? after.quantity_kind ?? "",
          decimalPlaces: decimalPlaces ?? Number.NaN,
        };
    const view = await createUnit(context.db, run.tenantId, run.membership, run.actor.subject, input);
    return [{ row, publicId: view.publicId, created: true, fieldsApplied: present(values, ...UNIT_FIELDS) }];
  }
  const publicId = requireTarget(row);
  await context.guard.enter({ kind: "inventory", sheet: "Units", publicId }, [row]);
  const expectedVersion = await lockedVersion(context, inventoryUnits, publicId);
  refuseImmutable(values, ["code", "quantity_kind", "standard_code"]);
  await updateUnit(context.db, run.tenantId, run.membership, run.actor.subject, publicId, {
    expectedVersion,
    ...(values.has("name") ? { nameEn: text(values, "name") } : {}),
    ...(values.has("name_ar") ? { nameAr: text(values, "name_ar") } : {}),
    ...(values.has("decimal_places") ? { decimalPlaces: int(values, "decimal_places") } : {}),
    ...(activeStatus(values) ? { status: activeStatus(values) } : {}),
  });
  return [{ row, publicId, fieldsApplied: present(values, ...UNIT_FIELDS) }];
};

const SUPPLIER_TEXT = { contact_name: "contactName", email: "email", phone: "phone", reference: "code", notes: "notes" };
const SUPPLIER_FIELDS = ["name", "contact_name", "email", "phone", "reference", "active", "notes"];

export const applySuppliers: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  if (row.operation === "create") {
    const view = await createSupplier(context.db, run.tenantId, run.membership, run.actor.subject, {
      nameEn: text(values, "name") ?? "",
      ...optionalFields(values, SUPPLIER_TEXT),
    });
    return [{ row, publicId: view.supplier.publicId, created: true, fieldsApplied: present(values, ...SUPPLIER_FIELDS) }];
  }
  const publicId = requireTarget(row);
  await context.guard.enter({ kind: "inventory", sheet: "Suppliers", publicId }, [row]);
  const expectedVersion = await lockedVersion(context, inventorySuppliers, publicId);
  await updateSupplier(context.db, run.tenantId, run.membership, run.actor.subject, publicId, {
    expectedVersion,
    ...(values.has("name") ? { nameEn: text(values, "name") } : {}),
    ...optionalFields(values, SUPPLIER_TEXT),
    ...(activeStatus(values) ? { status: activeStatus(values) } : {}),
  });
  return [{ row, publicId, fieldsApplied: present(values, ...SUPPLIER_FIELDS) }];
};

const WAREHOUSE_FIELDS = ["code", "name", "active", "notes"];

/* Warehouses: one per branch; the branch and code are fixed after create. */
export const applyWarehouses: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  if (row.operation === "create") {
    const view = await createWarehouse(context.db, run.tenantId, run.membership, run.actor.subject, {
      locationPublicId: resolveReference(run, row, "branch_key"),
      code: text(values, "code") ?? "",
      nameEn: text(values, "name") ?? "",
      ...optionalFields(values, { notes: "notes" }),
    });
    return [{ row, publicId: view.warehouse.publicId, created: true, fieldsApplied: present(values, ...WAREHOUSE_FIELDS) }];
  }
  const publicId = requireTarget(row);
  await context.guard.enter({ kind: "inventory", sheet: "Warehouses", publicId }, [row]);
  const expectedVersion = await lockedVersion(context, inventoryWarehouses, publicId);
  await updateWarehouse(context.db, run.tenantId, run.membership, run.actor.subject, publicId, {
    expectedVersion,
    // Sent so the service refuses a moved branch or a changed code exactly as the editor does.
    ...(values.has("branch_key") ? { locationPublicId: text(values, "branch_key") } : {}),
    ...(values.has("code") ? { code: text(values, "code") } : {}),
    ...(values.has("name") ? { nameEn: text(values, "name") } : {}),
    ...optionalFields(values, { notes: "notes" }),
    ...(activeStatus(values) ? { status: activeStatus(values) } : {}),
  });
  return [{ row, publicId, fieldsApplied: present(values, ...WAREHOUSE_FIELDS) }];
};

const CATEGORY_FIELDS = ["name_en", "name_ar", "active"];

export const applyInventoryCategories: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  if (row.operation === "create") {
    const view = await createCategory(context.db, run.tenantId, run.membership, run.actor.subject, {
      nameEn: text(values, "name_en") ?? "",
      ...optionalFields(values, { name_ar: "nameAr" }),
    });
    return [{ row, publicId: view.category.publicId, created: true, fieldsApplied: present(values, ...CATEGORY_FIELDS) }];
  }
  const publicId = requireTarget(row);
  await context.guard.enter({ kind: "inventory", sheet: "Inventory Categories", publicId }, [row]);
  const expectedVersion = await lockedVersion(context, inventoryCategories, publicId);
  await updateCategory(context.db, run.tenantId, run.membership, run.actor.subject, publicId, {
    expectedVersion,
    ...(values.has("name_en") ? { nameEn: text(values, "name_en") } : {}),
    ...optionalFields(values, { name_ar: "nameAr" }),
    ...(activeStatus(values) ? { status: activeStatus(values) } : {}),
  });
  return [{ row, publicId, fieldsApplied: present(values, ...CATEGORY_FIELDS) }];
};
