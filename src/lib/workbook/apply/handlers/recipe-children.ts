import { and, asc, eq, inArray } from "drizzle-orm";

import {
  catalogueModifierOptions,
  inventoryItems,
  inventoryUnits,
  recipes,
  recipeVersionLines,
  recipeVersionModifierEffects,
  recipeVersions,
  recipeVersionSteps,
} from "@/db/schema";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import { replaceDraftEffects } from "@/lib/recipes/effects-service";
import { replaceDraftLines, replaceDraftSteps } from "@/lib/recipes/versions";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { present, proposedValues, resolveReference, rowRef, text } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SavedRow, SheetHandler, Unit } from "@/lib/workbook/apply/handlers/types";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";

/* Recipe lines, prep steps and modifier effects (QOS-200, plan section 4.7):
   every row of one recipe version is one unit and one whole-list service
   call (replaceDraftLines / replaceDraftSteps / replaceDraftEffects), so the
   service validates the list together exactly as the recipe editor does.
   Only a draft is ever changed: rows for an approved version go to the draft
   its Recipes row made (D4); a line, step or effect of the approved version
   is matched to its copy in that draft (lines and effects by ingredient and
   option, steps by position). Existing rows the workbook does not mention are
   sent unchanged; archive leaves a row out (the service marks it removed,
   never deletes it). Positions follow sort_order / step_number. */

type Lock = { family: typeof recipes.$inferSelect; version: typeof recipeVersions.$inferSelect };

async function lockDraft(context: HandlerContext, unit: Unit): Promise<Lock> {
  const { run } = context;
  const primary = unit.rows[0]!;
  const versionPublicId = resolveReference(run, primary, "recipe_version_key");
  const [found] = await context.tx
    .select({ version: recipeVersions, family: recipes })
    .from(recipeVersions)
    .innerJoin(recipes, and(eq(recipes.tenantId, recipeVersions.tenantId), eq(recipes.id, recipeVersions.recipeId)))
    .where(and(eq(recipeVersions.tenantId, run.tenantId), eq(recipeVersions.publicId, versionPublicId)))
    .limit(1);
  if (!found) throw new ApplyUnitError("target_not_found", "Recipe version not found.", { field: "recipe_version_key" });
  if (found.version.status !== "draft") {
    throw new ApplyUnitError("service_validation", "This version is approved; add its recipe row so a draft is created.", {
      field: "recipe_version_key",
      reason: "recipe_draft_required",
    });
  }
  await context.guard.enter(
    { kind: "recipe", recipePublicId: found.family.publicId },
    unit.rows.filter((row) => row.operation !== "create"),
  );
  return found;
}

/** Workbook position of a row: its sort column, or after everything when blank. */
function positionOf(row: PlanRowRecord, column: string) {
  const value = Number(row.after?.[column] ?? "");
  return Number.isInteger(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

type Entry<T> = { value: T; key: number; order: number; row: PlanRowRecord | null };

/** Orders the merged list: workbook positions where given, existing rows keep their place, ties keep list order. */
function ordered<T>(entries: Array<Entry<T>>) {
  return [...entries].sort((a, b) => a.key - b.key || a.order - b.order);
}

/** The draft's record a row changes: its own id, or (D4) the copy in the draft of the approved record it names. */
function findTarget<T extends { publicId: string | null }>(
  entries: Array<Entry<T>>,
  row: PlanRowRecord,
  copyOf: (entry: Entry<T>) => boolean,
): Entry<T> {
  const own = entries.find((entry) => entry.value.publicId !== null && entry.value.publicId === row.targetPublicId);
  const match = own ?? entries.find((entry) => entry.row === null && copyOf(entry));
  if (!match) throw new ApplyUnitError("target_not_found", "The record this row changes is not on the draft.", { field: "recipe_version_key" });
  return match;
}

function rowsSaved(unit: Unit, family: string, version: string, publicIdOf: (row: PlanRowRecord) => string, columns: string[]): SavedRow[] {
  return unit.rows.map((row) => ({
    row,
    publicId: publicIdOf(row),
    ...(row.operation === "create" ? { created: true } : {}),
    fieldsApplied: present(proposedValues(row), ...columns),
    parentPublicId: family,
    versionPublicId: version,
  }));
}

async function itemUnits(context: HandlerContext, itemPublicIds: string[]) {
  if (itemPublicIds.length === 0) return new Map<string, { id: string; recipeUnit: string | null }>();
  const rows = await context.tx
    .select({ id: inventoryItems.id, publicId: inventoryItems.publicId, recipeUnit: inventoryUnits.publicId })
    .from(inventoryItems)
    .leftJoin(inventoryUnits, and(eq(inventoryUnits.tenantId, inventoryItems.tenantId), eq(inventoryUnits.id, inventoryItems.recipeUnitId)))
    .where(and(eq(inventoryItems.tenantId, context.run.tenantId), inArray(inventoryItems.publicId, itemPublicIds)));
  return new Map(rows.map((row) => [row.publicId, { id: row.id, recipeUnit: row.recipeUnit }]));
}

function recipeUnitOf(units: Map<string, { recipeUnit: string | null }>, itemPublicId: string, row: PlanRowRecord) {
  const unit = units.get(itemPublicId)?.recipeUnit;
  if (!unit) {
    throw new ApplyUnitError("service_validation", "This ingredient has no recipe unit.", { field: "ingredient_key", reason: "recipe_unit_required", responsible: rowRef(row) });
  }
  return unit;
}

/** Item public id of an existing line (snapshot record of the approved version, or the draft's own line). */
function snapshotItem(context: HandlerContext, sheet: "Recipe Lines" | "Modifier Effects", publicId: string | null) {
  return publicId ? (context.run.snapshot.records[sheet].get(publicId)?.ingredient_key ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* Recipe Lines                                                        */
/* ------------------------------------------------------------------ */

type LineValue = { publicId: string | null; itemPublicId: string; unitPublicId: string; quantity: string; labelEn: string | null; labelAr: string | null };

async function draftLines(context: HandlerContext, versionId: string) {
  return context.tx
    .select({ line: recipeVersionLines, item: inventoryItems.publicId, unit: inventoryUnits.publicId })
    .from(recipeVersionLines)
    .innerJoin(inventoryItems, and(eq(inventoryItems.tenantId, recipeVersionLines.tenantId), eq(inventoryItems.id, recipeVersionLines.itemId)))
    .innerJoin(inventoryUnits, and(eq(inventoryUnits.tenantId, recipeVersionLines.tenantId), eq(inventoryUnits.id, recipeVersionLines.unitId)))
    .where(and(eq(recipeVersionLines.tenantId, context.run.tenantId), eq(recipeVersionLines.recipeVersionId, versionId), eq(recipeVersionLines.status, "active")))
    .orderBy(asc(recipeVersionLines.position));
}

export const applyRecipeLines: SheetHandler = async (context, unit) => {
  const { run } = context;
  const { family, version } = await lockDraft(context, unit);
  const current = await draftLines(context, version.id);
  let entries: Array<Entry<LineValue>> = current.map(({ line, item, unit: unitPublicId }, index) => ({
    value: { publicId: line.publicId, itemPublicId: item, unitPublicId, quantity: microsToDecimalString(line.quantityMicros), labelEn: line.labelEn, labelAr: line.labelAr },
    key: line.position + 1,
    order: index,
    row: null,
  }));
  const items = await itemUnits(
    context,
    unit.rows.filter((row) => row.operation !== "archive" && (row.after?.ingredient_key ?? "")).map((row) => resolveReference(run, row, "ingredient_key")),
  );
  const removed = new Map<PlanRowRecord, string>();
  for (const [index, row] of unit.rows.entries()) {
    const values = proposedValues(row);
    if (row.operation === "create") {
      const itemPublicId = resolveReference(run, row, "ingredient_key");
      entries.push({
        value: { publicId: null, itemPublicId, unitPublicId: recipeUnitOf(items, itemPublicId, row), quantity: text(values, "quantity_recipe_units") ?? "", labelEn: null, labelAr: null },
        key: positionOf(row, "sort_order"),
        order: current.length + index,
        row,
      });
      continue;
    }
    const sourceItem = snapshotItem(context, "Recipe Lines", row.targetPublicId);
    const entry = findTarget(entries, row, (candidate) => candidate.value.itemPublicId === sourceItem);
    entry.row = row;
    if (row.operation === "archive") {
      removed.set(row, entry.value.publicId!);
      entries = entries.filter((candidate) => candidate !== entry);
      continue;
    }
    if (values.has("ingredient_key")) {
      entry.value.itemPublicId = resolveReference(run, row, "ingredient_key");
      entry.value.unitPublicId = recipeUnitOf(items, entry.value.itemPublicId, row);
    }
    if (values.has("quantity_recipe_units")) {
      // A workbook quantity is always in the ingredient's recipe unit.
      entry.value.quantity = text(values, "quantity_recipe_units") ?? "";
      entry.value.unitPublicId = recipeUnitOf(items.size > 0 ? items : await itemUnits(context, [entry.value.itemPublicId]), entry.value.itemPublicId, row);
    }
    if (values.has("sort_order")) entry.key = positionOf(row, "sort_order");
  }
  const list = ordered(entries);
  await replaceDraftLines(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, version.publicId, {
    expectedVersion: version.version,
    lines: list.map(({ value }) => ({
      ...(value.publicId ? { linePublicId: value.publicId } : {}),
      itemPublicId: value.itemPublicId,
      unitPublicId: value.unitPublicId,
      quantity: value.quantity,
      labelEn: value.labelEn,
      labelAr: value.labelAr,
    })),
  });
  const after = await draftLines(context, version.id);
  if (after.length !== list.length) throw new ApplyUnitError("unexpected", "The saved lines could not be read back.");
  return rowsSaved(unit, family.publicId, version.publicId, (row) => removed.get(row) ?? after[list.findIndex((entry) => entry.row === row)]!.line.publicId, [
    "ingredient_key",
    "quantity_recipe_units",
    "sort_order",
  ]);
};

/* ------------------------------------------------------------------ */
/* Prep Steps                                                          */
/* ------------------------------------------------------------------ */

type StepValue = { publicId: string | null; textEn: string; textAr: string | null; sourcePosition: number | null };

async function draftSteps(context: HandlerContext, versionId: string) {
  return context.tx
    .select()
    .from(recipeVersionSteps)
    .where(and(eq(recipeVersionSteps.tenantId, context.run.tenantId), eq(recipeVersionSteps.recipeVersionId, versionId), eq(recipeVersionSteps.status, "active")))
    .orderBy(asc(recipeVersionSteps.position));
}

export const applyPrepSteps: SheetHandler = async (context, unit) => {
  const { run } = context;
  const { family, version } = await lockDraft(context, unit);
  const current = await draftSteps(context, version.id);
  let entries: Array<Entry<StepValue>> = current.map((step, index) => ({
    value: { publicId: step.publicId, textEn: step.textEn, textAr: step.textAr, sourcePosition: step.position },
    key: step.position + 1,
    order: index,
    row: null,
  }));
  const removed = new Map<PlanRowRecord, string>();
  for (const [index, row] of unit.rows.entries()) {
    const values = proposedValues(row);
    if (row.operation === "create") {
      entries.push({ value: { publicId: null, textEn: text(values, "instruction") ?? "", textAr: null, sourcePosition: null }, key: positionOf(row, "step_number"), order: current.length + index, row });
      continue;
    }
    // A step of the approved version is matched to the draft's step in the same position.
    const sourceNumber = Number(run.snapshot.records["Prep Steps"].get(row.targetPublicId ?? "")?.step_number ?? "0") - 1;
    const entry = findTarget(entries, row, (candidate) => candidate.value.sourcePosition === sourceNumber);
    entry.row = row;
    if (row.operation === "archive") {
      removed.set(row, entry.value.publicId!);
      entries = entries.filter((candidate) => candidate !== entry);
      continue;
    }
    if (values.has("instruction")) entry.value.textEn = text(values, "instruction") ?? "";
    if (values.has("step_number")) entry.key = positionOf(row, "step_number");
  }
  const list = ordered(entries);
  await replaceDraftSteps(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, version.publicId, {
    expectedVersion: version.version,
    steps: list.map(({ value }) => ({ ...(value.publicId ? { stepPublicId: value.publicId } : {}), textEn: value.textEn, textAr: value.textAr })),
  });
  const after = await draftSteps(context, version.id);
  if (after.length !== list.length) throw new ApplyUnitError("unexpected", "The saved steps could not be read back.");
  return rowsSaved(unit, family.publicId, version.publicId, (row) => removed.get(row) ?? after[list.findIndex((entry) => entry.row === row)]!.publicId, [
    "step_number",
    "instruction",
  ]);
};

/* ------------------------------------------------------------------ */
/* Modifier Effects                                                    */
/* ------------------------------------------------------------------ */

type EffectValue = {
  publicId: string | null;
  optionPublicId: string;
  effectType: string;
  targetLinePublicId: string | null;
  itemPublicId: string | null;
  unitPublicId: string | null;
  quantity: string | null;
  notes: string | null;
};

async function draftEffects(context: HandlerContext, versionId: string) {
  const effects = await context.tx
    .select({ effect: recipeVersionModifierEffects, option: catalogueModifierOptions.publicId })
    .from(recipeVersionModifierEffects)
    .innerJoin(
      catalogueModifierOptions,
      and(eq(catalogueModifierOptions.tenantId, recipeVersionModifierEffects.tenantId), eq(catalogueModifierOptions.id, recipeVersionModifierEffects.modifierOptionId)),
    )
    .where(
      and(
        eq(recipeVersionModifierEffects.tenantId, context.run.tenantId),
        eq(recipeVersionModifierEffects.recipeVersionId, versionId),
        eq(recipeVersionModifierEffects.status, "active"),
      ),
    )
    .orderBy(asc(recipeVersionModifierEffects.position));
  return effects;
}

export const applyModifierEffects: SheetHandler = async (context, unit) => {
  const { run } = context;
  const { family, version } = await lockDraft(context, unit);
  const lines = await draftLines(context, version.id);
  const linePublicId = new Map(lines.map(({ line }) => [line.id, line.publicId]));
  const lineByItem = new Map(lines.map(({ line, item }) => [item, line.publicId]));
  const allItemIds = [...new Set((await draftEffects(context, version.id)).map(({ effect }) => effect.itemId).filter((id): id is string => Boolean(id)))];
  const itemRows =
    allItemIds.length === 0
      ? []
      : await context.tx
          .select({ id: inventoryItems.id, publicId: inventoryItems.publicId })
          .from(inventoryItems)
          .where(and(eq(inventoryItems.tenantId, run.tenantId), inArray(inventoryItems.id, allItemIds)));
  const itemPublicId = new Map(itemRows.map((row) => [row.id, row.publicId]));
  const unitRows = await context.tx.select({ id: inventoryUnits.id, publicId: inventoryUnits.publicId }).from(inventoryUnits).where(eq(inventoryUnits.tenantId, run.tenantId));
  const unitPublicId = new Map(unitRows.map((row) => [row.id, row.publicId]));
  const current = await draftEffects(context, version.id);
  let entries: Array<Entry<EffectValue>> = current.map(({ effect, option }, index) => ({
    value: {
      publicId: effect.publicId,
      optionPublicId: option,
      effectType: effect.effectType,
      targetLinePublicId: effect.targetLineId ? (linePublicId.get(effect.targetLineId) ?? null) : null,
      itemPublicId: effect.itemId ? (itemPublicId.get(effect.itemId) ?? null) : null,
      unitPublicId: effect.unitId ? (unitPublicId.get(effect.unitId) ?? null) : null,
      quantity: effect.quantityMicros === null ? null : microsToDecimalString(effect.quantityMicros),
      notes: effect.notes,
    },
    key: effect.position + 1,
    order: index,
    row: null,
  }));
  const items = await itemUnits(
    context,
    unit.rows.filter((row) => row.operation !== "archive" && (row.after?.ingredient_key ?? "")).map((row) => resolveReference(run, row, "ingredient_key")),
  );
  /** A base line by reference: a line of this draft, or (D4) the draft's copy of an approved line, matched by ingredient. */
  const targetLine = (row: PlanRowRecord) => {
    const named = resolveReference(run, row, "target_recipe_line_key");
    if (lines.some(({ line }) => line.publicId === named)) return named;
    const copied = lineByItem.get(snapshotItem(context, "Recipe Lines", named) ?? "");
    if (!copied) throw new ApplyUnitError("target_not_found", "The base line is not on the draft.", { field: "target_recipe_line_key" });
    return copied;
  };
  const removed = new Map<PlanRowRecord, string>();
  for (const [index, row] of unit.rows.entries()) {
    const values = proposedValues(row);
    const after = row.after ?? {};
    const shape = (entry: EffectValue) => {
      const type = (after.effect_type ?? entry.effectType).toLowerCase();
      entry.effectType = type;
      entry.targetLinePublicId = type === "add" ? null : (after.target_recipe_line_key ?? "") ? targetLine(row) : entry.targetLinePublicId;
      if (type === "remove") {
        entry.itemPublicId = null;
        entry.unitPublicId = null;
        entry.quantity = null;
      } else {
        if (values.has("ingredient_key") || row.operation === "create") entry.itemPublicId = resolveReference(run, row, "ingredient_key");
        if (values.has("quantity_per_sold_unit") || values.has("ingredient_key") || row.operation === "create") {
          entry.quantity = after.quantity_per_sold_unit ?? entry.quantity;
          entry.unitPublicId = recipeUnitOf(items, entry.itemPublicId ?? "", row);
        }
      }
      if (values.has("notes")) entry.notes = text(values, "notes") ?? null;
    };
    if (row.operation === "create") {
      const value: EffectValue = {
        publicId: null,
        optionPublicId: resolveReference(run, row, "modifier_option_key"),
        effectType: "add",
        targetLinePublicId: null,
        itemPublicId: null,
        unitPublicId: null,
        quantity: null,
        notes: null,
      };
      shape(value);
      entries.push({ value, key: Number.MAX_SAFE_INTEGER, order: current.length + index, row });
      continue;
    }
    const source = run.snapshot.records["Modifier Effects"].get(row.targetPublicId ?? "");
    const sourceTargetItem = snapshotItem(context, "Recipe Lines", source?.target_recipe_line_key ?? null);
    const entry = findTarget(
      entries,
      row,
      (candidate) =>
        candidate.value.optionPublicId === source?.modifier_option_key &&
        candidate.value.effectType === (source?.effect_type ?? "").toLowerCase() &&
        (candidate.value.itemPublicId ?? "") === (source?.ingredient_key ?? "") &&
        (sourceTargetItem === null || lineByItem.get(sourceTargetItem) === candidate.value.targetLinePublicId),
    );
    entry.row = row;
    if (row.operation === "archive") {
      removed.set(row, entry.value.publicId!);
      entries = entries.filter((candidate) => candidate !== entry);
      continue;
    }
    if (values.has("modifier_option_key")) entry.value.optionPublicId = resolveReference(run, row, "modifier_option_key");
    shape(entry.value);
  }
  const list = ordered(entries);
  await replaceDraftEffects(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, version.publicId, {
    expectedVersion: version.version,
    effects: list.map(({ value }) => ({
      ...(value.publicId ? { effectPublicId: value.publicId } : {}),
      optionPublicId: value.optionPublicId,
      effectType: value.effectType,
      ...(value.targetLinePublicId ? { targetLinePublicId: value.targetLinePublicId } : {}),
      ...(value.itemPublicId ? { itemPublicId: value.itemPublicId, unitPublicId: value.unitPublicId, quantity: value.quantity } : {}),
      notes: value.notes,
    })),
  });
  const after = await draftEffects(context, version.id);
  if (after.length !== list.length) throw new ApplyUnitError("unexpected", "The saved effects could not be read back.");
  return rowsSaved(unit, family.publicId, version.publicId, (row) => removed.get(row) ?? after[list.findIndex((entry) => entry.row === row)]!.effect.publicId, [
    "modifier_option_key",
    "effect_type",
    "target_recipe_line_key",
    "ingredient_key",
    "quantity_per_sold_unit",
    "notes",
  ]);
};
