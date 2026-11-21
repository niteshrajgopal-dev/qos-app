import { and, eq } from "drizzle-orm";

import { brands, catalogueMenus, catalogueProducts, locations } from "@/db/schema";
import { contractSheet } from "@/lib/workbook/contract";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import type { HandlerContext } from "@/lib/workbook/apply/handlers/types";
import type { ApplyRuntime } from "@/lib/workbook/apply/handlers/types";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";

/* Helpers shared by the sheet handlers (QOS-217). Values come from the plan
   row only: every column on a create, the changed columns on an update.
   A blank on update is absent (keep); a cleared optional column is null;
   "0" is zero and FALSE is false. */

export type Values = Map<string, string | null>;

/** What a row asks a service to write. */
export function proposedValues(row: PlanRowRecord): Values {
  if (row.operation === "create") {
    return new Map(Object.entries(row.after ?? {}).map(([column, value]) => [column, value === "" ? null : value]));
  }
  return new Map(row.changes.map((change) => [change.column, change.after === null || change.after === "" ? null : change.after]));
}

export function text(values: Values, column: string): string | null | undefined {
  return values.has(column) ? values.get(column)! : undefined;
}

export function int(values: Values, column: string): number | null | undefined {
  const value = text(values, column);
  if (value === undefined || value === null) return value;
  return Number(value);
}

export function flag(values: Values, column: string): boolean | undefined {
  const value = text(values, column);
  return value === undefined || value === null ? undefined : value === "TRUE";
}

/** A value the service cannot clear: refused rather than silently kept. */
export function notClearable(values: Values, column: string) {
  if (values.has(column) && values.get(column) === null) {
    throw new ApplyUnitError("service_validation", `${column} cannot be cleared by this service.`, { field: column, reason: "not_clearable" });
  }
}

export function present(values: Values, ...columns: string[]) {
  return columns.filter((column) => values.has(column));
}

/** Display-name translations of the changed locales only, for partial updates. */
export function nameTranslations(values: Values, en = "display_name_en", ar = "display_name_ar") {
  const translations: { en?: { displayName: string }; ar?: { displayName: string } } = {};
  if (values.has(en)) translations.en = { displayName: values.get(en) ?? "" };
  if (values.has(ar)) translations.ar = { displayName: values.get(ar) ?? "" };
  return translations;
}

export function rowRef(row: PlanRowRecord) {
  return { sheet: row.sheet, row: row.rowNumber, key: row.entityKey };
}

/**
 * The public id a reference column names, in this order: an existing record
 * of the snapshot; the record saved for the referenced workbook row (this
 * attempt or an earlier one); a typed source link. Names are never
 * consulted. Anything else fails `dependency_unresolved` naming the row
 * responsible.
 */
export function resolveReference(run: ApplyRuntime, row: PlanRowRecord, column: string): string {
  const value = (row.after?.[column] ?? row.before?.[column] ?? "").trim();
  const refSheet = contractSheet(row.sheet).columns.find((entry) => entry.key === column)?.ref?.sheet;
  if (!refSheet || !value) {
    throw new ApplyUnitError("dependency_unresolved", `${column} is missing.`, { field: column });
  }
  if (refSheet === "Branches") {
    if (run.snapshot.permittedBranches.has(value)) return value;
    throw new ApplyUnitError("branch_not_permitted", "This branch is outside the plan's branch scope.", { field: column });
  }
  const records = run.snapshot.records[refSheet as keyof typeof run.snapshot.records];
  if (records?.has(value)) return value;
  const referenced = run.rowsByKey.get(refSheet)?.get(value);
  if (referenced) {
    const saved = run.saved.get(referenced.id) ?? referenced.appliedPublicId ?? referenced.targetPublicId;
    if (saved) return saved;
  }
  const linked = run.snapshot.typedLinks.get(refSheet)?.get(value);
  if (linked) return linked;
  throw new ApplyUnitError("dependency_unresolved", `${refSheet} ${value} was not saved.`, {
    field: column,
    ...(referenced ? { responsible: rowRef(referenced) } : {}),
  });
}

/** The internal id of a permitted branch in the plan's scope. */
export async function branchLocation(context: HandlerContext, publicId: string) {
  if (!context.run.snapshot.permittedBranches.has(publicId)) {
    throw new ApplyUnitError("branch_not_permitted", "This branch is outside the plan's branch scope.", { field: "branch_key" });
  }
  const [location] = await context.tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, context.run.tenantId), eq(locations.publicId, publicId)))
    .limit(1);
  if (!location) {
    throw new ApplyUnitError("target_not_found", "Branch not found.", { field: "branch_key" });
  }
  return location.id;
}

async function planBrandId(context: HandlerContext) {
  return context.run.plan.brandId;
}

/** A product of this tenant and of the plan's brand, locked for the unit. */
export async function lockProduct(context: HandlerContext, publicId: string) {
  const [product] = await context.tx
    .select()
    .from(catalogueProducts)
    .where(and(eq(catalogueProducts.tenantId, context.run.tenantId), eq(catalogueProducts.publicId, publicId)))
    .limit(1)
    .for("update");
  if (!product) throw new ApplyUnitError("target_not_found", "Product not found.");
  if (product.brandId !== (await planBrandId(context))) {
    throw new ApplyUnitError("brand_mismatch", "This product belongs to another brand.");
  }
  return product;
}

/** A menu of this tenant and of the plan's brand, locked for the unit. */
export async function lockMenu(context: HandlerContext, publicId: string) {
  const [menu] = await context.tx
    .select()
    .from(catalogueMenus)
    .where(and(eq(catalogueMenus.tenantId, context.run.tenantId), eq(catalogueMenus.publicId, publicId)))
    .limit(1)
    .for("update");
  if (!menu) throw new ApplyUnitError("target_not_found", "Menu not found.");
  if (menu.brandId !== (await planBrandId(context))) {
    throw new ApplyUnitError("brand_mismatch", "This menu belongs to another brand.");
  }
  return menu;
}

/** The plan's brand public id, checked to still belong to the tenant. */
export async function planBrandPublicId(context: HandlerContext) {
  const [brand] = await context.tx
    .select({ publicId: brands.publicId })
    .from(brands)
    .where(and(eq(brands.tenantId, context.run.tenantId), eq(brands.id, context.run.plan.brandId)))
    .limit(1);
  if (!brand) throw new ApplyUnitError("brand_mismatch", "The plan's brand is no longer part of this business.");
  return brand.publicId;
}

export function requireTarget(row: PlanRowRecord) {
  if (!row.targetPublicId) {
    throw new ApplyUnitError("target_not_found", "This row has no target record.");
  }
  return row.targetPublicId;
}

/**
 * New records are saved as drafts, or as active when the record has no draft
 * state. Foodics conversion writes `draft` on every sheet to mean "do not
 * publish"; for records without a draft state that is accepted and the
 * service creates them active. Any other status needs another service.
 */
export function assertCreateStatus(values: Values, allowed: string[]) {
  const status = text(values, "status");
  if (!status || allowed.includes(status)) return;
  if (status === "draft" && allowed.includes("active")) return;
  throw new ApplyUnitError("service_validation", `New records cannot be created as ${status}.`, { field: "status", reason: "status_requires_publication" });
}
