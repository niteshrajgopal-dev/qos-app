import { parseCategoryFields } from "@/lib/inventory/categories";
import { InventoryError } from "@/lib/inventory/errors";
import { ITEM_NAME_MAX_LENGTH } from "@/lib/inventory/items";
import { parseFactorMicros, rational } from "@/lib/inventory/quantity-math";
import { parseCostAmount } from "@/lib/inventory/reference-costs";
import { parseOptionalName, parseOptionalNotes, parseOptionalText, parseRecordCode, parseRequiredName } from "@/lib/inventory/shared";
import { standardUnit } from "@/lib/inventory/standard-units";
import { parseSupplierFields } from "@/lib/inventory/suppliers";
import { validateCreateUnitInput, validateUpdateUnitInput } from "@/lib/inventory/units";
import { WAREHOUSE_NAME_MAX_LENGTH, WAREHOUSE_NOTES_MAX_LENGTH } from "@/lib/inventory/warehouses";
import { EFFECT_NOTES_MAX_LENGTH } from "@/lib/recipes/effects-service";
import { RECIPE_NAME_MAX_LENGTH, RECIPE_NOTES_MAX_LENGTH, STEP_TEXT_MAX_LENGTH } from "@/lib/recipes/shared";
import {
  fractionDigits,
  isDraftRecipeRecord,
  quantityKindOf,
  RECIPE_CHILD_SHEETS,
  RECIPE_TARGET_KIND,
  sameFactor,
  standardFactor,
  standardUnitOfRow,
  unitFactsOfRow,
} from "@/lib/workbook/phase2-values";
import { candidateOf } from "@/lib/workbook/validation/identity";
import type { ReviewCandidate, ReviewClassification, ReviewDiagnostic } from "@/lib/workbook/validation/model";
import { RECIPE_FAMILY_LINKS, type ReviewSnapshot } from "@/lib/workbook/validation/snapshot";
import { addDiagnostic, type WorkRow } from "@/lib/workbook/validation/work";

/* Review rules of the Phase 2 sheets (QOS-200, plan sections 2 and 3.3).
   Row checks call the inventory and recipe services' own pure parsers, so
   preview refuses what apply would refuse; the sheet-level pass applies the
   draft policy (D4), one active warehouse per branch, one recipe per
   prepared item and one live link per sold variant against the snapshot.
   Apply rechecks everything through the services themselves. */

type Row = Record<string, string>;

const PROPOSING = new Set<ReviewClassification>(["create", "update", "unchanged"]);

/** A row's values as they will be after apply: the proposal when there is one, else the record. */
export function effectiveValues(work: WorkRow): Row {
  return work.after ?? work.before ?? work.typed;
}

/** What a reference column of a row points at: a workbook row (edge) or an existing record. */
export function referenced(work: WorkRow, column: string, snapshot: ReviewSnapshot): { values: Row | null; publicId: string | null; work: WorkRow | null } {
  const edge = work.edges.find((entry) => entry.column === column);
  if (edge) return { values: effectiveValues(edge.target), publicId: edge.target.identity.targetPublicId, work: edge.target };
  const publicId = work.endpoints[column] ?? null;
  const refSheet = work.def.columns.find((entry) => entry.key === column)?.ref?.sheet;
  if (publicId && refSheet) {
    const records = snapshot.records[refSheet as keyof ReviewSnapshot["records"]];
    return { values: records?.get(publicId) ?? null, publicId, work: null };
  }
  return { values: null, publicId: null, work: null };
}

function refusal(column: string, reason: string, message: string): ReviewDiagnostic {
  return { severity: "error", code: "service_validation", column, params: { field: column, message, reason } };
}

/** Service field names back to the workbook column that carries them. */
const SERVICE_FIELD_COLUMN: Record<string, Record<string, string>> = {
  Units: { nameEn: "name", nameAr: "name_ar", code: "code", quantityKind: "quantity_kind", decimalPlaces: "decimal_places", standardCode: "standard_code" },
  Suppliers: { nameEn: "name", contactName: "contact_name", code: "reference" },
  Warehouses: { nameEn: "name" },
  "Inventory Categories": { nameEn: "name_en", nameAr: "name_ar" },
  Ingredients: { nameEn: "name_en", nameAr: "name_ar", factor: "recipe_units_per_storage_unit", amount: "reference_cost_per_storage_unit" },
  Recipes: { nameEn: "name", yieldQuantity: "yield_quantity" },
  "Prep Steps": { textEn: "instruction" },
};

function fromServiceError(sheet: string, error: InventoryError): ReviewDiagnostic {
  const column = (error.field && SERVICE_FIELD_COLUMN[sheet]?.[error.field]) ?? error.field ?? "";
  return { severity: "error", code: "service_validation", ...(column ? { column } : {}), params: { field: column, message: error.message, reason: error.code } };
}

const has = (values: Row, column: string) => values[column] !== undefined;
const blankToNull = (value: string | undefined) => (value === undefined || value === "" ? null : value);

function changed(work: WorkRow, column: string) {
  return work.changes.some((change) => change.column === column);
}

/**
 * Builds what the Phase 2 service would take for this row and runs the
 * service's own parser. `values` are the proposed values: all of them on
 * create, the changed ones on update. Returns the first refusal.
 */
export function checkPhase2Service(work: WorkRow, values: Row, snapshot: ReviewSnapshot): ReviewDiagnostic | null {
  const create = work.operation === "create";
  try {
    if ((work.def.columns.some((column) => column.key === "active") && create && values.active === "FALSE")) {
      return refusal("active", "create_inactive", "New records are created active; archive them afterwards.");
    }
    switch (work.sheet) {
      case "Units":
        return checkUnit(work, values, create);
      case "Suppliers":
        parseSupplierFields(
          Object.fromEntries(
            (
              [
                ["nameEn", "name"],
                ["contactName", "contact_name"],
                ["email", "email"],
                ["phone", "phone"],
                ["code", "reference"],
                ["notes", "notes"],
              ] as const
            )
              .filter(([, column]) => has(values, column))
              .map(([field, column]) => [field, blankToNull(values[column])]),
          ),
          create,
        );
        return null;
      case "Inventory Categories":
        parseCategoryFields(
          {
            ...(has(values, "name_en") ? { nameEn: values.name_en } : {}),
            ...(has(values, "name_ar") ? { nameAr: blankToNull(values.name_ar) } : {}),
          },
          create,
        );
        return null;
      case "Warehouses":
        if (create) parseRecordCode(values.code, "code");
        else if (changed(work, "code")) return refusal("code", "warehouse_code_immutable", "The code cannot change after the warehouse is created.");
        if (create || has(values, "name")) parseRequiredName(values.name, "nameEn", WAREHOUSE_NAME_MAX_LENGTH);
        if (has(values, "notes")) parseOptionalText(blankToNull(values.notes), "notes", WAREHOUSE_NOTES_MAX_LENGTH);
        return null;
      case "Ingredients":
        return checkIngredient(work, values, create, snapshot);
      case "Recipes":
        return checkRecipe(work, values, create, snapshot);
      case "Recipe Lines":
        return checkLine(work, values, snapshot);
      case "Prep Steps":
        if (has(values, "instruction")) {
          const text = (values.instruction ?? "").trim();
          if (text.length > STEP_TEXT_MAX_LENGTH) return refusal("instruction", "step_text_too_long", `Steps can be at most ${STEP_TEXT_MAX_LENGTH} characters.`);
        }
        return null;
      case "Modifier Effects":
        return checkEffect(work, values, snapshot);
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof InventoryError) return fromServiceError(work.sheet, error);
    throw error;
  }
}

function checkUnit(work: WorkRow, values: Row, create: boolean): ReviewDiagnostic | null {
  if (!create) {
    for (const column of ["code", "quantity_kind", "standard_code"]) {
      if (changed(work, column)) return refusal(column, "immutable_field", "This field cannot change after the unit is created.");
    }
    validateUpdateUnitInput({
      expectedVersion: 1,
      ...(has(values, "name") ? { nameEn: values.name } : {}),
      ...(has(values, "name_ar") ? { nameAr: values.name_ar } : {}),
      ...(has(values, "decimal_places") ? { decimalPlaces: Number(values.decimal_places) } : {}),
    });
    return null;
  }
  const standard = standardUnitOfRow(values);
  const kind = quantityKindOf(values.quantity_kind);
  if (standard) {
    const definition = standardUnit(standard.code)!;
    if (kind && kind !== definition.dimension) {
      return refusal("quantity_kind", "standard_unit_kind_mismatch", "The quantity kind does not match this standard unit.");
    }
    validateCreateUnitInput({
      source: "standard",
      standardCode: standard.code,
      ...(has(values, "decimal_places") ? { decimalPlaces: Number(values.decimal_places) } : {}),
      ...(standard.byName ? {} : { ...(values.name ? { nameEn: values.name } : {}), ...(values.name_ar ? { nameAr: values.name_ar } : {}) }),
    });
    return null;
  }
  if (!values.code) return refusal("code", "code_required", "A custom unit needs a code.");
  if (!values.name_ar) return refusal("name_ar", "arabic_name_required", "A custom unit needs an Arabic name.");
  validateCreateUnitInput({
    source: "custom",
    code: values.code,
    nameEn: values.name,
    nameAr: values.name_ar,
    quantityKind: kind ?? values.quantity_kind,
    decimalPlaces: Number(values.decimal_places),
  });
  return null;
}

/** Facts of the unit a reference column points at, from the workbook row or the record. */
function unitOf(work: WorkRow, column: string, snapshot: ReviewSnapshot) {
  const target = referenced(work, column, snapshot);
  return target.values ? { ...unitFactsOfRow(target.values), id: target.publicId ?? `row:${target.work?.input.row}` } : null;
}

function checkIngredient(work: WorkRow, values: Row, create: boolean, snapshot: ReviewSnapshot): ReviewDiagnostic | null {
  if (create || has(values, "name_en")) parseRequiredName(values.name_en, "nameEn", ITEM_NAME_MAX_LENGTH);
  if (has(values, "name_ar")) parseOptionalName(blankToNull(values.name_ar), "nameAr", ITEM_NAME_MAX_LENGTH);
  if (has(values, "notes")) parseOptionalNotes(blankToNull(values.notes));
  const after = effectiveValues(work);
  const factorTouched = has(values, "recipe_units_per_storage_unit") || has(values, "storage_unit_key") || has(values, "recipe_unit_key");
  const factor = after.recipe_units_per_storage_unit ?? "";
  if (factorTouched && factor) {
    const parsed = parseFactorMicros(factor);
    if (parsed.status === "invalid") throw new InventoryError("Enter the factor as a plain decimal number.", 400, parsed.code, "factor");
    const storage = unitOf(work, "storage_unit_key", snapshot);
    const recipe = unitOf(work, "recipe_unit_key", snapshot);
    if (storage && recipe && storage.id === recipe.id && !sameFactor(factor, rational(BigInt(1)))) {
      return refusal("recipe_units_per_storage_unit", "factor_conflicts_with_standard", "The storage and recipe units are the same unit; the factor must be 1.");
    }
    const standard = storage && recipe ? standardFactor(storage.standardCode, recipe.standardCode) : null;
    if (standard && !sameFactor(factor, standard)) {
      return refusal(
        "recipe_units_per_storage_unit",
        "factor_conflicts_with_standard",
        "Both units are standard units of one kind; the factor must equal the standard conversion.",
      );
    }
  }
  if (has(values, "reference_cost_per_storage_unit") && values.reference_cost_per_storage_unit) {
    parseCostAmount(values.reference_cost_per_storage_unit);
  }
  return null;
}

function checkRecipe(work: WorkRow, values: Row, create: boolean, snapshot: ReviewSnapshot): ReviewDiagnostic | null {
  if (!create) {
    if (changed(work, "recipe_key")) return refusal("recipe_key", "immutable_field", "A recipe version cannot move to another recipe.");
    if (changed(work, "target_type")) {
      const family = work.before?.recipe_key ?? "";
      const approved = [...snapshot.records.Recipes.values()].some((row) => row.recipe_key === family && !isDraftRecipeRecord(row));
      if (approved) return refusal("target_type", "recipe_kind_immutable", "The kind is fixed once a version has been approved.");
    }
  }
  if (create || has(values, "name")) parseRequiredName(values.name, "nameEn", RECIPE_NAME_MAX_LENGTH);
  if (has(values, "notes")) parseOptionalText(blankToNull(values.notes), "notes", RECIPE_NOTES_MAX_LENGTH);
  const after = effectiveValues(work);
  const kind = RECIPE_TARGET_KIND[after.target_type ?? ""];
  if (kind === "sellable" && after.prepared_ingredient_key) {
    return refusal("prepared_ingredient_key", "output_item_not_allowed", "A sellable recipe has no prepared item.");
  }
  if (kind === "prepared") {
    if (after.variant_key) return refusal("variant_key", "target_type_mismatch", "A prepared recipe is not linked to a sold variant.");
    const output = referenced(work, "prepared_ingredient_key", snapshot).values;
    if (output && (output.ingredient_type ?? "").toUpperCase() !== "PREPARED") {
      return refusal("prepared_ingredient_key", "output_item_not_prepared", "The output of a prepared recipe must be a prepared item.");
    }
  }
  if ((has(values, "yield_quantity") || has(values, "yield_unit_key")) && after.yield_quantity) {
    const unit = unitOf(work, "yield_unit_key", snapshot);
    if (unit?.decimalPlaces !== null && unit?.decimalPlaces !== undefined && fractionDigits(after.yield_quantity) > unit.decimalPlaces) {
      return refusal("yield_quantity", "yield_too_precise", `The yield unit allows at most ${unit.decimalPlaces} decimal places.`);
    }
  }
  return null;
}

/** The recipe unit of the ingredient a line or effect names, or why there is none. */
function ingredientRecipeUnit(work: WorkRow, snapshot: ReviewSnapshot) {
  const ingredient = referenced(work, "ingredient_key", snapshot);
  if (!ingredient.values) return { known: false as const };
  const unitKey = ingredient.values.recipe_unit_key ?? "";
  if (!unitKey) return { known: true as const, unit: null };
  const edgeRow = ingredient.work?.edges.find((edge) => edge.column === "recipe_unit_key")?.target;
  const unitValues = edgeRow ? effectiveValues(edgeRow) : snapshot.records.Units.get(ingredient.work?.endpoints.recipe_unit_key ?? unitKey);
  return { known: true as const, unit: unitValues ? unitFactsOfRow(unitValues) : null };
}

function checkQuantity(work: WorkRow, column: string, text: string | undefined, snapshot: ReviewSnapshot): ReviewDiagnostic | null {
  if (!text) return null;
  const recipeUnit = ingredientRecipeUnit(work, snapshot);
  if (recipeUnit.known && recipeUnit.unit === null && !referenced(work, "ingredient_key", snapshot).values?.recipe_unit_key) {
    return refusal("ingredient_key", "recipe_unit_required", "This ingredient has no recipe unit.");
  }
  const places = recipeUnit.known ? recipeUnit.unit?.decimalPlaces : null;
  if (places !== null && places !== undefined && fractionDigits(text) > places) {
    return refusal(column, "quantity_too_precise", `The ingredient's recipe unit allows at most ${places} decimal places.`);
  }
  return null;
}

function checkLine(work: WorkRow, values: Row, snapshot: ReviewSnapshot): ReviewDiagnostic | null {
  if (has(values, "quantity_recipe_units") || has(values, "ingredient_key")) {
    return checkQuantity(work, "quantity_recipe_units", effectiveValues(work).quantity_recipe_units, snapshot);
  }
  return null;
}

function checkEffect(work: WorkRow, values: Row, snapshot: ReviewSnapshot): ReviewDiagnostic | null {
  const after = effectiveValues(work);
  const type = (after.effect_type ?? "").toUpperCase();
  const recipe = referenced(work, "recipe_version_key", snapshot).values;
  if (recipe && RECIPE_TARGET_KIND[recipe.target_type ?? ""] === "prepared") {
    return refusal("recipe_version_key", "effects_sellable_only", "Modifier effects apply to sellable recipes only.");
  }
  if (type === "ADD" && after.target_recipe_line_key) return refusal("target_recipe_line_key", "target_line_not_allowed", "An add effect has no base line.");
  if (type !== "ADD" && !after.target_recipe_line_key) return refusal("target_recipe_line_key", "target_line_required", "Choose the base line this effect removes or replaces.");
  if (type === "REMOVE" && (after.ingredient_key || after.quantity_per_sold_unit)) {
    return refusal("ingredient_key", "effect_item_not_allowed", "A remove effect has no ingredient or quantity.");
  }
  if (type !== "REMOVE") {
    if (!after.ingredient_key) return refusal("ingredient_key", "effect_item_required", "Choose the ingredient this effect adds.");
    if (!after.quantity_per_sold_unit) return refusal("quantity_per_sold_unit", "quantity_invalid", "Enter the quantity this effect adds.");
    const quantity = checkQuantity(work, "quantity_per_sold_unit", after.quantity_per_sold_unit, snapshot);
    if (quantity) return quantity;
  }
  if (has(values, "notes") && (values.notes ?? "").trim().length > EFFECT_NOTES_MAX_LENGTH) {
    return refusal("notes", "effect_notes_too_long", `Notes can be at most ${EFFECT_NOTES_MAX_LENGTH} characters.`);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Sheet-level rules                                                   */
/* ------------------------------------------------------------------ */

type Pass = { works: WorkRow[]; snapshot: ReviewSnapshot; keysVerified: boolean };

function conflictWith(work: WorkRow, candidates: ReviewCandidate[], reason: string) {
  work.classification = "conflicting";
  work.operation = null;
  work.candidates = candidates;
  addDiagnostic(work, { severity: "error", code: "existing_record_conflict", params: { candidates: candidates.length, reason } });
}

function refuse(work: WorkRow, column: string, reason: string, message: string) {
  addDiagnostic(work, refusal(column, reason, message));
  work.classification = "invalid";
  work.operation = null;
}

const proposing = (work: WorkRow) => work.classification === "create" || work.classification === "update";

/** Existing family a Recipes row belongs to: its target's, a typed `recipe` link, or (QOS export) the family id itself. */
export function familyOfRecipeRow(work: WorkRow, snapshot: ReviewSnapshot, keysVerified: boolean): string | null {
  if (work.identity.targetPublicId) return snapshot.records.Recipes.get(work.identity.targetPublicId)?.recipe_key ?? null;
  const key = work.typed.recipe_key ?? "";
  if (!key) return null;
  const links = snapshot.typedLinks.get(RECIPE_FAMILY_LINKS);
  const linked = links?.get(key) ?? ([...(links?.values() ?? [])].includes(key) ? key : undefined);
  if (linked) return linked;
  if (keysVerified && [...snapshot.records.Recipes.values()].some((row) => row.recipe_key === key)) return key;
  return null;
}

function familyVersions(snapshot: ReviewSnapshot, family: string) {
  return [...snapshot.records.Recipes.entries()].filter(([, row]) => row.recipe_key === family);
}

/**
 * Runs after the row checks and before blocking. Children of an approved
 * version make its Recipes row a draft-creating update; then one draft per
 * family, draft conflicts, prepared outputs, sold-variant links and
 * warehouse branches are checked against the snapshot.
 */
export function enforcePhase2(pass: Pass) {
  const { works, snapshot } = pass;
  promoteRecipesForChildren(pass);
  enforceRecipeDrafts(pass);
  enforceRecipeTargets(pass);
  enforceWarehouseBranches(works, snapshot);
  enforceLineItems(works, snapshot);
  enforceStepNumbers(works);
}

function promoteRecipesForChildren({ works, snapshot }: Pass) {
  for (const child of works) {
    if (!RECIPE_CHILD_SHEETS.has(child.sheet) || !proposing(child)) continue;
    const version = referenced(child, "recipe_version_key", snapshot);
    if (version.work) {
      const parent = version.work;
      const approvedTarget = Boolean(parent.identity.targetPublicId) && !isDraftRecipeRecord(parent.before);
      if (approvedTarget && parent.classification === "unchanged") {
        // An approved version is never changed: its row now creates the draft the child rows are saved to.
        parent.classification = "update";
        parent.operation = "update";
        parent.changes = [];
        addDiagnostic(parent, { severity: "info", code: "recipe_draft_created" });
      } else if (approvedTarget && parent.classification === "skipped") {
        refuse(child, "recipe_version_key", "recipe_draft_required", "This version is approved; add its recipe row so a draft is created.");
      }
      continue;
    }
    if (version.values && !isDraftRecipeRecord(version.values)) {
      refuse(child, "recipe_version_key", "recipe_draft_required", "This version is approved; add its recipe row so a draft is created.");
    }
  }
}

function enforceRecipeDrafts({ works, snapshot, keysVerified }: Pass) {
  const draftMakers = new Map<string, WorkRow[]>();
  for (const work of works) {
    if (work.sheet !== "Recipes" || !work.supported || !work.classification || !PROPOSING.has(work.classification)) continue;
    const family = familyOfRecipeRow(work, snapshot, keysVerified);
    const target = work.identity.targetPublicId ? snapshot.records.Recipes.get(work.identity.targetPublicId) : undefined;
    const openDraft = family ? familyVersions(snapshot, family).find(([, row]) => isDraftRecipeRecord(row)) : undefined;
    if (work.classification === "update" && work.operation === "archive" && target && !isDraftRecipeRecord(target)) {
      refuse(work, "action", "version_not_draft", "Approved versions cannot change; a new draft is created instead.");
      continue;
    }
    const makesDraft = work.classification === "create" || (work.classification === "update" && target !== undefined && !isDraftRecipeRecord(target));
    if (!makesDraft) continue;
    if (openDraft && openDraft[0] !== work.identity.targetPublicId) {
      conflictWith(work, [candidateOf(snapshot, "Recipes", openDraft[0], "name_collision")], "draft_exists");
      continue;
    }
    const groupKey = family ? `id:${family}` : `new:${work.typed.recipe_key ?? work.key}`;
    draftMakers.set(groupKey, [...(draftMakers.get(groupKey) ?? []), work]);
  }
  for (const group of draftMakers.values()) {
    for (const work of group.slice(1)) {
      refuse(work, "recipe_key", "draft_exists", "A recipe has one open draft; this workbook already creates one for it.");
    }
  }
}

function enforceRecipeTargets({ works, snapshot, keysVerified }: Pass) {
  for (const work of works) {
    if (work.sheet !== "Recipes" || !proposing(work)) continue;
    const family = familyOfRecipeRow(work, snapshot, keysVerified);
    const after = effectiveValues(work);
    const others = [...snapshot.records.Recipes.entries()].filter(([, row]) => row.recipe_key !== family);
    if (after.target_type === "PREPARED_ITEM" && (work.operation === "create" || changed(work, "prepared_ingredient_key"))) {
      const output = referenced(work, "prepared_ingredient_key", snapshot).publicId;
      const taken = output ? others.find(([, row]) => row.prepared_ingredient_key === output) : undefined;
      if (taken) {
        conflictWith(work, [candidateOf(snapshot, "Recipes", taken[0], "name_collision")], "output_item_taken");
        continue;
      }
    }
    if (after.target_type === "SOLD_VARIANT" && (work.operation === "create" || changed(work, "variant_key"))) {
      const variant = referenced(work, "variant_key", snapshot).publicId;
      const linked = variant ? others.find(([, row]) => row.variant_key === variant) : undefined;
      if (linked) conflictWith(work, [candidateOf(snapshot, "Recipes", linked[0], "name_collision")], "variant_linked_elsewhere");
    }
  }
}

function enforceWarehouseBranches(works: WorkRow[], snapshot: ReviewSnapshot) {
  const archivedHere = new Set(
    works.filter((work) => work.sheet === "Warehouses" && work.identity.targetPublicId && work.after?.active === "FALSE").map((work) => work.identity.targetPublicId!),
  );
  const creating = new Map<string, WorkRow>();
  for (const work of works) {
    if (work.sheet !== "Warehouses" || work.classification !== "create") continue;
    const branch = work.endpoints.branch_key;
    if (!branch) continue;
    const active = [...snapshot.records.Warehouses.entries()].find(
      ([publicId, row]) => row.branch_key === branch && row.active === "TRUE" && !archivedHere.has(publicId),
    );
    if (active) {
      conflictWith(work, [candidateOf(snapshot, "Warehouses", active[0], "name_collision")], "warehouse_branch_taken");
      continue;
    }
    if (creating.has(branch)) {
      refuse(work, "branch_key", "warehouse_branch_taken", "This branch already gets a warehouse from another row of this workbook.");
      continue;
    }
    creating.set(branch, work);
  }
}

/** The version a child row's list belongs to: the Recipes row of this workbook, or the existing version. */
function versionGroup(work: WorkRow) {
  const edge = work.edges.find((entry) => entry.column === "recipe_version_key");
  if (edge) return { key: `row:${edge.target.input.row}`, recordId: edge.target.identity.targetPublicId };
  const id = work.endpoints.recipe_version_key;
  return id ? { key: `id:${id}`, recordId: id } : null;
}

function enforceLineItems(works: WorkRow[], snapshot: ReviewSnapshot) {
  const groups = new Map<string, { recordId: string | null; rows: WorkRow[] }>();
  for (const work of works) {
    if (work.sheet !== "Recipe Lines" || !work.supported || !work.classification || !PROPOSING.has(work.classification)) continue;
    const group = versionGroup(work);
    if (!group) continue;
    const entry = groups.get(group.key) ?? { recordId: group.recordId, rows: [] };
    entry.rows.push(work);
    groups.set(group.key, entry);
  }
  for (const group of groups.values()) {
    const touched = new Set(group.rows.map((work) => work.identity.targetPublicId).filter(Boolean));
    const items = new Map<string, WorkRow | null>();
    if (group.recordId) {
      for (const [publicId, row] of snapshot.records["Recipe Lines"]) {
        if (row.recipe_version_key === group.recordId && !touched.has(publicId)) items.set(row.ingredient_key ?? "", null);
      }
    }
    for (const work of group.rows) {
      if (work.operation === "archive") continue;
      const item = referenced(work, "ingredient_key", snapshot);
      const id = item.publicId ?? (item.work ? `row:${item.work.input.row}` : "");
      if (!id) continue;
      if (items.has(id)) {
        refuse(work, "ingredient_key", "duplicate_line_item", "Each ingredient can appear once per recipe version.");
        continue;
      }
      items.set(id, work);
    }
  }
}

function enforceStepNumbers(works: WorkRow[]) {
  const seen = new Map<string, WorkRow>();
  for (const work of works) {
    if (work.sheet !== "Prep Steps" || !proposing(work) || work.operation === "archive") continue;
    const group = versionGroup(work);
    const number = effectiveValues(work).step_number;
    if (!group || !number) continue;
    const id = `${group.key}\u0000${number}`;
    if (seen.has(id)) {
      refuse(work, "step_number", "duplicate_step_number", "Two steps of this recipe version have the same number.");
      continue;
    }
    seen.set(id, work);
  }
}

/** Existing standard units a new Units row would add again: candidates, never a target. */
export function standardUnitCandidates(snapshot: ReviewSnapshot, values: Row): ReviewCandidate[] {
  const standard = standardUnitOfRow(values);
  if (!standard) return [];
  return [...snapshot.records.Units.entries()]
    .filter(([, row]) => row.standard_code === standard.code)
    .map(([publicId]) => candidateOf(snapshot, "Units", publicId, "name_collision"));
}
