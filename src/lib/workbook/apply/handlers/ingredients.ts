import { and, eq, isNull } from "drizzle-orm";

import { inventoryItemConversions, inventoryItemReferenceCosts, inventoryItems } from "@/db/schema";
import { majorToMicrosExact } from "@/lib/catalogue/selling-tax-cost";
import { closeConversion, createConversion, reviseConversion } from "@/lib/inventory/conversions";
import { createItem, updateItem } from "@/lib/inventory/items";
import { fromMicros } from "@/lib/inventory/quantity-math";
import { closeReferenceCost, setReferenceCost } from "@/lib/inventory/reference-costs";
import { loadTenantUnitsInTx } from "@/lib/inventory/shared";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { activeStatus } from "@/lib/workbook/apply/handlers/inventory-masters";
import { present, proposedValues, requireTarget, resolveReference, text, type Values } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SheetHandler } from "@/lib/workbook/apply/handlers/types";
import type { AppliedRecord } from "@/lib/workbook/apply/model";
import { currentItemCost, currentItemFactor } from "@/lib/workbook/phase2-records";
import { sameFactor } from "@/lib/workbook/phase2-values";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";

/* Ingredients (QOS-200, decision D12): one unit saves the inventory item,
   then its storage-to-recipe conversion, then its dated reference cost, all
   through the QOS-195/197 services and in one transaction. A conversion or
   cost change is a new dated revision, never an overwrite; identical values
   are a no-op, so a repeated apply creates nothing. A blank cost stays
   unknown (never zero); an explicit "0" is a known zero. Two standard units
   store no rule: the workbook factor must equal the standard one. */

const ITEM_COLUMNS = ["name_en", "name_ar", "ingredient_type", "active", "notes"];
const ITEM_REFERENCES = ["inventory_category_key", "storage_unit_key", "recipe_unit_key", "default_supplier_key"];
const FACTOR = "recipe_units_per_storage_unit";
const COST_COLUMNS = ["reference_cost_per_storage_unit", "cost_currency", "cost_tax_basis", "cost_effective_date", "cost_source_reference"];

function lower(value: string | null | undefined) {
  return value ? value.toLowerCase() : undefined;
}

function optionalReference(context: HandlerContext, row: PlanRowRecord, column: string) {
  const value = (row.after?.[column] ?? "").trim();
  return value ? resolveReference(context.run, row, column) : undefined;
}

async function lockItem(context: HandlerContext, publicId: string) {
  const [item] = await context.tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, context.run.tenantId), eq(inventoryItems.publicId, publicId)))
    .limit(1)
    .for("update");
  if (!item) throw new ApplyUnitError("target_not_found", "Ingredient not found.");
  return item;
}

async function currentRules(context: HandlerContext, itemId: string) {
  return context.tx
    .select()
    .from(inventoryItemConversions)
    .where(
      and(
        eq(inventoryItemConversions.tenantId, context.run.tenantId),
        eq(inventoryItemConversions.itemId, itemId),
        isNull(inventoryItemConversions.effectiveTo),
      ),
    );
}

async function currentCosts(context: HandlerContext, itemId: string) {
  return context.tx
    .select()
    .from(inventoryItemReferenceCosts)
    .where(
      and(
        eq(inventoryItemReferenceCosts.tenantId, context.run.tenantId),
        eq(inventoryItemReferenceCosts.itemId, itemId),
        isNull(inventoryItemReferenceCosts.effectiveTo),
      ),
    );
}

/** Saves the storage → recipe factor: verified for same or standard units, else created, revised or closed. */
async function applyFactor(context: HandlerContext, itemPublicId: string, values: Values, after: Record<string, string>): Promise<AppliedRecord | null> {
  const { run } = context;
  const item = await lockItem(context, itemPublicId);
  const units = await loadTenantUnitsInTx(context.tx, run.tenantId);
  const rules = await currentRules(context, item.id);
  const current = currentItemFactor(item, units, rules);
  const wanted = values.has(FACTOR) ? text(values, FACTOR) : after[FACTOR] || null;
  const unitPublicId = (id: string | null) => units.find((unit) => unit.id === id)?.publicId ?? "";
  const mutation = [run.tenantId, run.membership, run.actor.subject, item.publicId] as const;

  if (current.source === "same_unit" || current.source === "standard") {
    const known = decimalOf(current.text);
    if (wanted && (!known || !sameFactor(wanted, known))) {
      throw new ApplyUnitError("service_validation", "Both units are standard units of one kind; the factor must equal the standard conversion.", {
        field: FACTOR,
        reason: "factor_conflicts_with_standard",
      });
    }
    return { kind: "conversion", publicId: "standard", note: "standard", created: false };
  }
  if (wanted === null) {
    if (!current.rule) return null;
    await closeConversion(context.db, ...mutation, current.rule.publicId, { expectedRevision: current.rule.revision });
    return { kind: "conversion", publicId: current.rule.publicId, revision: current.rule.revision, note: "closed", created: false };
  }
  if (current.text && sameFactor(wanted, decimalOf(current.text)!)) return null;
  if (current.rule && current.forward) {
    await reviseConversion(context.db, ...mutation, current.rule.publicId, { operation: "revise", expectedRevision: current.rule.revision, factor: wanted });
  } else {
    if (current.rule) {
      // A rule written recipe → storage is ended and replaced by the storage → recipe rule the workbook states.
      await closeConversion(context.db, ...mutation, current.rule.publicId, { expectedRevision: current.rule.revision });
    }
    await createConversion(context.db, ...mutation, {
      fromUnitPublicId: unitPublicId(item.storageUnitId),
      toUnitPublicId: unitPublicId(item.recipeUnitId),
      factor: wanted,
    });
  }
  const saved = currentItemFactor(item, units, await currentRules(context, item.id)).rule;
  return saved ? { kind: "conversion", publicId: saved.publicId, revision: saved.revision, created: true, effectiveFrom: saved.effectiveFrom } : null;
}

function decimalOf(textValue: string) {
  const parsed = majorToMicrosExact(textValue);
  return parsed.status === "ok" ? fromMicros(parsed.value) : null;
}

/** Saves the dated reference cost per storage unit: a new revision when anything differs, closed when cleared. */
async function applyCost(context: HandlerContext, itemPublicId: string, values: Values, after: Record<string, string>): Promise<AppliedRecord | null> {
  const { run } = context;
  const item = await lockItem(context, itemPublicId);
  const current = currentItemCost(await currentCosts(context, item.id));
  const mutation = [run.tenantId, run.membership, run.actor.subject, item.publicId] as const;
  if (values.has("reference_cost_per_storage_unit") && text(values, "reference_cost_per_storage_unit") === null) {
    if (!current) return null;
    await closeReferenceCost(context.db, ...mutation, current.publicId, {
      expectedRevision: current.revision,
      ...(after.cost_effective_date ? { effectiveFrom: after.cost_effective_date } : {}),
    });
    return { kind: "reference_cost", publicId: current.publicId, revision: current.revision, note: "closed", created: false };
  }
  const amount = after.reference_cost_per_storage_unit ?? "";
  // Blank is unknown, never zero: no cost row is written.
  if (!amount) return null;
  const parsed = majorToMicrosExact(amount);
  const taxBasis = lower(after.cost_tax_basis) ?? "unconfirmed";
  const sourceReference = after.cost_source_reference || null;
  if (
    current &&
    parsed.status === "ok" &&
    current.unitId === item.storageUnitId &&
    current.amountMicros === parsed.value &&
    current.taxBasis === taxBasis &&
    (current.sourceReference ?? null) === sourceReference &&
    (!after.cost_currency || current.currency.trim() === after.cost_currency) &&
    (!after.cost_effective_date || current.effectiveFrom === after.cost_effective_date)
  ) {
    return null;
  }
  const units = await loadTenantUnitsInTx(context.tx, run.tenantId);
  await setReferenceCost(context.db, ...mutation, {
    amount,
    currency: after.cost_currency || null,
    unitPublicId: units.find((unit) => unit.id === item.storageUnitId)?.publicId ?? null,
    taxBasis,
    source: "manual",
    sourceReference,
    effectiveFrom: after.cost_effective_date || null,
    expectedRevision: current?.revision ?? null,
  });
  const saved = currentItemCost(await currentCosts(context, item.id));
  return saved ? { kind: "reference_cost", publicId: saved.publicId, revision: saved.revision, created: true, effectiveFrom: saved.effectiveFrom } : null;
}

export const applyIngredients: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);
  const after = row.after ?? {};
  let publicId: string;
  let created = false;

  if (row.operation === "create") {
    const detail = await createItem(context.db, run.tenantId, run.membership, run.actor.subject, {
      nameEn: text(values, "name_en") ?? "",
      nameAr: text(values, "name_ar") ?? null,
      kind: lower(text(values, "ingredient_type")),
      notes: text(values, "notes") ?? null,
      storageUnitPublicId: resolveReference(run, row, "storage_unit_key"),
      recipeUnitPublicId: resolveReference(run, row, "recipe_unit_key"),
      ...(optionalReference(context, row, "inventory_category_key") ? { categoryPublicId: optionalReference(context, row, "inventory_category_key") } : {}),
      ...(optionalReference(context, row, "default_supplier_key") ? { defaultSupplierPublicId: optionalReference(context, row, "default_supplier_key") } : {}),
    });
    publicId = detail.item.publicId;
    created = true;
  } else {
    publicId = requireTarget(row);
    await context.guard.enter({ kind: "item", itemPublicId: publicId }, [row]);
    const item = await lockItem(context, publicId);
    const patch = {
      ...(values.has("name_en") ? { nameEn: text(values, "name_en") } : {}),
      ...(values.has("name_ar") ? { nameAr: text(values, "name_ar") } : {}),
      ...(values.has("ingredient_type") ? { kind: lower(text(values, "ingredient_type")) } : {}),
      ...(values.has("notes") ? { notes: text(values, "notes") } : {}),
      ...(values.has("storage_unit_key") ? { storageUnitPublicId: resolveReference(run, row, "storage_unit_key") } : {}),
      ...(values.has("recipe_unit_key") ? { recipeUnitPublicId: resolveReference(run, row, "recipe_unit_key") } : {}),
      ...(values.has("inventory_category_key") ? { categoryPublicId: optionalReference(context, row, "inventory_category_key") ?? null } : {}),
      ...(values.has("default_supplier_key") ? { defaultSupplierPublicId: optionalReference(context, row, "default_supplier_key") ?? null } : {}),
    };
    const status = activeStatus(values);
    // Archive last: restore first so the conversion and cost services accept an active item.
    if (Object.keys(patch).length > 0 || status === "active") {
      await updateItem(context.db, run.tenantId, run.membership, run.actor.subject, publicId, {
        expectedVersion: item.version,
        ...patch,
        ...(status === "active" ? { status } : {}),
      });
    }
  }

  const records: AppliedRecord[] = [];
  const archiving = activeStatus(values) === "archived";
  const unitsChanged = values.has("storage_unit_key") || values.has("recipe_unit_key");
  if (!archiving && (values.has(FACTOR) || (unitsChanged && after[FACTOR]))) {
    const record = await applyFactor(context, publicId, values, after);
    if (record) records.push(record);
  }
  if (!archiving && COST_COLUMNS.some((column) => values.has(column))) {
    const record = await applyCost(context, publicId, values, after);
    if (record) records.push(record);
  }
  if (archiving) {
    const item = await lockItem(context, publicId);
    await updateItem(context.db, run.tenantId, run.membership, run.actor.subject, publicId, { expectedVersion: item.version, status: "archived" });
  }
  return [
    {
      row,
      publicId,
      ...(created ? { created: true } : {}),
      fieldsApplied: present(values, ...ITEM_COLUMNS, ...ITEM_REFERENCES, FACTOR, ...COST_COLUMNS),
      ...(records.length > 0 ? { records } : {}),
    },
  ];
};
