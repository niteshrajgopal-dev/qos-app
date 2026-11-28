import { validateCreateCategoryInput, validateUpdateCategoryInput } from "@/lib/catalogue/category-validation";
import { MenuValidationError, validateCreateDraftMenuInput, validateUpdateDraftMenuInput } from "@/lib/catalogue/menus.validation";
import {
  validateAttachModifierGroupInput,
  validateCreateModifierGroupInput,
  validateCreateModifierOptionInput,
  validateUpdateModifierGroupInput,
  validateUpdateModifierOptionInput,
} from "@/lib/catalogue/modifier-validation";
import { CatalogueValidationError, validateCreateDraftProductInput, validateUpdateDraftProductInput } from "@/lib/catalogue/validation";
import {
  assertVariantLabelsForMultipleChoices,
  validateCreateProductVariantInput,
  validateUpdateProductVariantInput,
} from "@/lib/catalogue/variant-validation";
import type { WorkbookColumnDefinition } from "@/lib/workbook/contract";
import { deferredOwner, isDeferredColumn, PROVENANCE_COPIES } from "@/lib/workbook/validation/capability";
import type { ReviewDeferredField, ReviewDiagnostic } from "@/lib/workbook/validation/model";
import type { ReviewSnapshot } from "@/lib/workbook/validation/snapshot";
import {
  type CellResult,
  parseBoolean,
  parseClearFields,
  parseDecimalSyntax,
  parseEnum,
  parseExactDecimal,
  parseIsoDate,
  parseInteger,
  parseMinorUnits,
  parseRevision,
  parseUrl,
} from "@/lib/workbook/validation/types";
import { addDiagnostic, type WorkRow } from "@/lib/workbook/validation/work";
import { SOURCE_MAP_SHEET } from "@/lib/workbook/dictionary";
import { checkPhase2Service } from "@/lib/workbook/validation/phase2-review";

const PHASE2_SHEETS: ReadonlySet<string> = new Set([
  "Units",
  "Suppliers",
  "Warehouses",
  "Inventory Categories",
  "Ingredients",
  "Recipes",
  "Recipe Lines",
  "Prep Steps",
  "Modifier Effects",
]);

/* Entity rules (QOS-194, plan section 2.8): strict typing, conditional
   inputs, service parity and the sheet-level rules (one default variant,
   default options within the group limit). Preview rejects what apply would
   reject by calling the same validators the catalogue services call. */

const MECHANICS = new Set(["action", "expected_revision", "clear_fields", "row_check"]);
const CURRENCY_COLUMNS = new Set(["currency", "cost_currency"]);

function typeCell(
  column: WorkbookColumnDefinition,
  text: string,
  snapshot: ReviewSnapshot,
  strict: boolean,
): CellResult<string> {
  if (CURRENCY_COLUMNS.has(column.key)) {
    const expected = snapshot.currency.toUpperCase();
    if (text.toUpperCase() !== expected) {
      return { ok: false, diagnostic: { severity: "error", code: "currency_mismatch", column: column.key, params: { value: text, expected } } };
    }
    return text === expected
      ? { ok: true, value: expected }
      : { ok: true, value: expected, notes: [{ severity: "info", code: "value_normalized", column: column.key, params: { value: text, normalized: expected } }] };
  }
  const bounds = { min: column.min, max: column.max };
  switch (column.type) {
    case "money_minor": {
      const parsed = parseMinorUnits(text, column.key);
      return parsed.ok ? { ok: true, value: String(parsed.value) } : parsed;
    }
    case "integer": {
      const parsed = parseInteger(text, column.key, column.key === "tax_rate_basis_points" ? { min: 0, max: 10_000 } : bounds);
      return parsed.ok ? { ok: true, value: String(parsed.value) } : parsed;
    }
    case "url":
      return parseUrl(text, column.key);
    case "decimal":
    case "money":
      // Applied Phase 2 decimals are exact and refused when malformed (QOS-200); deferred ones are syntax-checked only.
      return strict
        ? parseExactDecimal(text, column.key, { positive: column.positive })
        : parseDecimalSyntax(text, column.key, { positive: column.positive, min: column.min });
    case "date":
      return strict ? parseIsoDate(text, column.key) : { ok: true, value: text };
    default:
      if (column.values && column.values.length > 0) {
        if (column.values.length === 2 && column.values.includes("TRUE") && column.values.includes("FALSE")) {
          const parsed = parseBoolean(text, column.key);
          return parsed.ok ? { ok: true, value: parsed.value ? "TRUE" : "FALSE", notes: parsed.notes } : parsed;
        }
        return parseEnum(text, column.key, column.values);
      }
      return { ok: true, value: text };
  }
}

/**
 * Types every cell of a row. Blank stays blank: on create a required blank
 * is an error, on update it means "keep". A value in a deferred column is
 * checked for syntax only and a failure is a warning, since QOS keeps it
 * aside and never applies it here. Skip rows are typed only where they
 * identify something (ids, references, revision).
 */
export function typeRow(work: WorkRow, snapshot: ReviewSnapshot) {
  const op = work.op ?? "update";
  for (const column of work.def.columns) {
    if (column.key === "action" || column.key === "clear_fields") continue;
    const text = (work.input.values[column.key] ?? "").trim();
    const deferred = work.supported && isDeferredColumn(work.sheet, column.key);

    if (column.isKey) {
      if (!text) addDiagnostic(work, { severity: work.supported ? "error" : "warning", code: "required_missing", column: column.key });
      else work.typed[column.key] = text;
      continue;
    }
    if (column.key === "expected_revision") {
      const parsed = parseRevision(text, column.key);
      if (!parsed.ok) addDiagnostic(work, parsed.diagnostic);
      else if (parsed.value) work.typed[column.key] = parsed.value;
      continue;
    }
    if (op === "skip" && !column.readonly && column.type !== "reference") continue;

    if (!text) {
      if (column.required && op === "create" && !column.readonly && !deferred && work.supported) {
        addDiagnostic(work, { severity: "error", code: "required_missing", column: column.key });
      }
      continue;
    }
    if (column.readonly && column.type !== "integer") {
      work.typed[column.key] = text;
      continue;
    }
    const parsed = typeCell(column, text, snapshot, work.supported && !deferred);
    if (!parsed.ok) {
      const soft = deferred || !work.supported;
      addDiagnostic(work, soft ? { ...parsed.diagnostic, severity: "warning" } : parsed.diagnostic);
      continue;
    }
    for (const note of parsed.notes ?? []) addDiagnostic(work, note);
    work.typed[column.key] = parsed.value;
  }

  const clear = parseClearFields((work.input.values.clear_fields ?? "").trim(), work.def, work.input.values, op === "create" ? "create" : "update");
  for (const diagnostic of clear.diagnostics) addDiagnostic(work, diagnostic);
  work.clears = clear.columns;
}

/* Conditional inputs (`required_when`). On deferred sheets they are warnings,
   so the operator sees the gap now; on the Phase 2 sheets the review passes
   the severity (QOS-200). */
function conditionHolds(clause: string, values: Record<string, string>) {
  const provided = /^(\w+) is provided$/.exec(clause);
  if (provided) return Boolean(values[provided[1]!]?.trim());
  const positive = /^(\w+) > 0$/.exec(clause);
  if (positive) {
    const value = Number(values[positive[1]!]?.trim() || "0");
    return Number.isFinite(value) && value > 0;
  }
  return null;
}

export function checkConditionalInputs(work: WorkRow, severity: "error" | "warning" = "warning") {
  for (const column of work.def.columns) {
    if (!column.required_when || (work.input.values[column.key] ?? "").trim()) continue;
    let applies = false;
    let lastEquals: string | null = null;
    for (const clause of column.required_when.split(" or ").map((part) => part.trim())) {
      const equals = /^(\w+) = (\S+)$/.exec(clause);
      if (equals) {
        lastEquals = equals[1]!;
        applies ||= (work.input.values[lastEquals] ?? "").trim().toUpperCase() === equals[2]!.toUpperCase();
        continue;
      }
      const holds = conditionHolds(clause, work.input.values);
      if (holds !== null) {
        applies ||= holds;
        lastEquals = null;
      } else if (lastEquals && /^\S+$/.test(clause)) {
        applies ||= (work.input.values[lastEquals] ?? "").trim().toUpperCase() === clause.toUpperCase();
      }
    }
    if (applies) {
      addDiagnostic(work, { severity, code: "required_missing", column: column.key, params: { condition: column.required_when } });
    }
  }
}

function percentDisplay(basisPoints: number) {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

/**
 * Values QOS recognises but cannot store yet: deferred columns of a supported
 * row, and values a source adapter kept beside the canonical columns. Tax
 * keeps its exact source text next to the basis points (0.05 → 500 → 5%).
 * They are stored on the plan row for QOS-212–215 and never counted as
 * proposed changes.
 */
export function deferredFieldsOf(work: WorkRow): ReviewDeferredField[] {
  const fields: ReviewDeferredField[] = [];
  const source = work.input.source;
  for (const column of work.def.columns) {
    const value = (work.input.values[column.key] ?? "").trim();
    if (!value || MECHANICS.has(column.key) || !isDeferredColumn(work.sheet, column.key)) continue;
    const field: ReviewDeferredField = { column: column.key, value, owner: deferredOwner(work.sheet, column.key) };
    const cell = source?.cells[column.key];
    if (cell) field.cell = cell;
    if (column.key === "tax_rate_basis_points" && /^(0|[1-9][0-9]*)$/.test(value)) {
      const basisPoints = Number(value);
      const sourceText = source?.preserved?.tax?.value ?? source?.values.tax ?? value;
      fields.push({ ...field, display: { sourceText, basisPoints, percentDisplay: percentDisplay(basisPoints) } });
      continue;
    }
    fields.push(field);
  }
  for (const [name, preserved] of Object.entries(source?.preserved ?? {})) {
    if (PROVENANCE_COPIES.has(name)) continue;
    fields.push({ column: name, value: preserved.value, owner: deferredOwner(SOURCE_MAP_SHEET, name), cell: preserved.cell });
  }
  return fields;
}

/* ------------------------------------------------------------------ */
/* Service parity                                                      */
/* ------------------------------------------------------------------ */

function parityRefusal(field: string, reason: string, message: string): ReviewDiagnostic {
  return { severity: "error", code: "service_validation", params: { field, message, reason } };
}

/** The effective default flag of the variant a branch price row names: the workbook row's value, else the record's. */
function variantIsDefault(work: WorkRow, snapshot: ReviewSnapshot) {
  const edge = work.edges.find((entry) => entry.column === "variant_key");
  if (edge) {
    const target = edge.target;
    return (target.after?.is_default ?? target.typed.is_default ?? target.before?.is_default ?? "") === "TRUE";
  }
  const variant = work.endpoints.variant_key ? snapshot.records.Variants.get(work.endpoints.variant_key) : undefined;
  return variant?.is_default === "TRUE";
}

/** Records with no draft state: `draft` on them can only mean "do not publish". */
const NO_DRAFT_STATE_SHEETS = new Set(["Categories", "Variants", "Modifier Groups", "Modifier Options"]);

/**
 * Foodics conversion and the blank template write `draft` to mean "do not
 * publish". On a product or menu update that is not a restore, that is not a
 * request to change status — drop it so the rest of the row can still apply.
 * Categories, variants, modifier groups and options have no draft state:
 * `draft` never changes them, whatever their status (restoring an archived
 * one needs `active`), so a re-upload never downgrades an active record.
 */
export function dropImportStatus(work: WorkRow) {
  const noDraftState = NO_DRAFT_STATE_SHEETS.has(work.sheet);
  if ((work.sheet !== "Products" && work.sheet !== "Menus" && !noDraftState) || work.classification !== "update") return;
  const change = work.changes.find((entry) => entry.column === "status");
  if (!change) return;
  const before = work.before?.status;
  if (change.after === "draft" && (before !== "archived" || noDraftState)) {
    work.changes = work.changes.filter((entry) => entry.column !== "status");
    if (work.after && before !== undefined) work.after.status = before;
    // An archived record the workbook marks draft stays archived: no restore.
    if (work.operation === "restore") work.operation = "update";
  }
}

/**
 * Service parity rules QOS-217 adds (decisions D-STATUS-FIELD, D-BRANCH-PRICE
 * and the menu location rule): what no catalogue service can do is refused at
 * review, so preview rejects what apply would reject. Apply rechecks them.
 * Workbook `draft` on an update is stripped by `dropImportStatus` first.
 */
export function checkApplyParity(work: WorkRow, context: ServiceContext): ReviewDiagnostic | null {
  const create = work.operation === "create";
  const status = create ? work.after?.status : work.changes.find((change) => change.column === "status")?.after;
  if (work.sheet === "Products" || work.sheet === "Menus") {
    if (create && status !== undefined && status !== "draft") {
      return parityRefusal("status", "status_requires_publication", "New records are saved as drafts; only publication activates them.");
    }
    if (!create && status !== undefined) {
      const before = work.before?.status;
      const productLifecycle = work.sheet === "Products" && (status === "archived" || (before === "archived" && status === "draft"));
      if (!productLifecycle) {
        return parityRefusal("status", "status_requires_publication", "No service changes this status; publish or use the editor.");
      }
    }
  }
  if (work.sheet === "Menus" && create && context.menuLocations(work.key).length === 0) {
    return parityRefusal("locationIds", "menu_requires_branch", "A new menu needs at least one Menu Branches row in this workbook.");
  }
  if (work.sheet === "Branch Prices" && !variantIsDefault(work, context.snapshot)) {
    return parityRefusal("variant_key", "branch_price_default_variant_only", "Branch prices can be set for the default variant only.");
  }
  return null;
}

export type ServiceContext = {
  snapshot: ReviewSnapshot;
  /** Price of the default variant the workbook gives a new product, when valid. */
  defaultVariantAmount: (productKey: string) => number | null;
  /** Branch public ids the workbook links a new menu to. */
  menuLocations: (menuKey: string) => string[];
  /** Active variants a product will have after this review. */
  variantCount: (productPublicIdOrKey: string) => number;
};

function maybeInt(value: string | undefined) {
  return value === undefined || value === "" ? undefined : Number(value);
}

function bool(value: string | undefined) {
  return value === undefined ? undefined : value === "TRUE";
}

function translations(values: Record<string, string>, en: string, ar: string) {
  return { en: { displayName: values[en] ?? "" }, ar: { displayName: values[ar] ?? "" } };
}

function partialTranslations(values: Record<string, string>, en: string, ar: string) {
  return {
    ...(values[en] !== undefined ? { en: { displayName: values[en] } } : {}),
    ...(values[ar] !== undefined ? { ar: { displayName: values[ar] } } : {}),
  };
}

function statusForService(value: string | undefined): "active" | "archived" | undefined {
  return value === "active" || value === "archived" ? value : undefined;
}

/**
 * Builds the input the catalogue service would take for this row and runs
 * the service's own validator. A refusal becomes Invalid `service_validation`
 * with the service's field and message. `values` are the proposed values
 * (all of them on create, only the changed ones on update).
 */
export function checkService(work: WorkRow, values: Record<string, string>, context: ServiceContext): ReviewDiagnostic | null {
  if (PHASE2_SHEETS.has(work.sheet)) return checkPhase2Service(work, values, context.snapshot);
  const create = work.operation === "create";
  try {
    switch (work.sheet) {
      case "Categories":
        if (create) {
          validateCreateCategoryInput({ internalName: values.internal_name ?? "", sortOrder: maybeInt(values.sort_order), translations: translations(values, "display_name_en", "display_name_ar") });
        } else {
          validateUpdateCategoryInput({
            expectedVersion: 1,
            internalName: values.internal_name,
            sortOrder: maybeInt(values.sort_order),
            status: values.status as "active" | "archived" | undefined,
            translations: partialTranslations(values, "display_name_en", "display_name_ar"),
          });
        }
        break;
      case "Products":
        if (create) {
          validateCreateDraftProductInput(
            {
              internalName: values.internal_name ?? "",
              sku: values.sku ?? null,
              barcode: values.barcode ?? null,
              nutritionCalories: maybeInt(values.nutrition_calories) ?? null,
              translations: {
                en: { displayName: values.display_name_en ?? "", description: values.description_en ?? null },
                ar: { displayName: values.display_name_ar ?? "", description: values.description_ar ?? null },
              },
              defaultVariant: { amountMinor: context.defaultVariantAmount(work.key) ?? 0, currency: context.snapshot.currency },
            },
            context.snapshot.businessProfile,
          );
        } else {
          validateUpdateDraftProductInput(
            {
              expectedVersion: 1,
              internalName: values.internal_name,
              sku: values.sku,
              barcode: values.barcode,
              nutritionCalories: values.nutrition_calories === undefined ? undefined : (maybeInt(values.nutrition_calories) ?? null),
              translations: {
                ...(values.display_name_en !== undefined || values.description_en !== undefined
                  ? { en: { displayName: values.display_name_en, description: values.description_en } }
                  : {}),
                ...(values.display_name_ar !== undefined || values.description_ar !== undefined
                  ? { ar: { displayName: values.display_name_ar, description: values.description_ar } }
                  : {}),
              },
            },
            context.snapshot.businessProfile,
          );
        }
        break;
      case "Variants": {
        const input = {
          expectedProductVersion: 1,
          sortOrder: maybeInt(values.sort_order),
          isDefault: bool(values.is_default),
          sku: values.sku,
          barcode: values.barcode,
          amountMinor: maybeInt(values.amount_minor),
          translations: partialTranslations(values, "variant_label_en", "variant_label_ar"),
        };
        if (create) validateCreateProductVariantInput({ ...input, currency: values.currency });
        else validateUpdateProductVariantInput({ ...input, status: statusForService(values.status) });
        const product = work.endpoints.product_key ?? work.input.values.product_key ?? "";
        if (work.after?.status !== "archived") {
          const labels = {
            en: { displayName: work.after?.variant_label_en ?? "" },
            ar: { displayName: work.after?.variant_label_ar ?? "" },
          };
          assertVariantLabelsForMultipleChoices(context.variantCount(product), labels, "variant");
        }
        break;
      }
      case "Modifier Groups":
        if (create) {
          validateCreateModifierGroupInput({
            internalName: values.internal_name ?? "",
            minSelections: maybeInt(values.min_selections),
            maxSelections: maybeInt(values.max_selections),
            translations: translations(values, "display_name_en", "display_name_ar"),
          });
        } else {
          validateUpdateModifierGroupInput({
            expectedVersion: 1,
            internalName: values.internal_name,
            // The service checks the bounds as a pair; send the resulting pair.
            minSelections: maybeInt(work.after?.min_selections),
            maxSelections: maybeInt(work.after?.max_selections),
            status: statusForService(values.status),
            translations: partialTranslations(values, "display_name_en", "display_name_ar"),
          });
        }
        break;
      case "Modifier Options": {
        const input = {
          expectedGroupVersion: 1,
          sortOrder: maybeInt(values.sort_order),
          isDefault: bool(values.is_default),
          allowsQuantity: bool(values.allows_quantity),
          maxQuantity: maybeInt(values.max_quantity),
          priceMinor: maybeInt(values.price_minor),
          translations: partialTranslations(values, "display_name_en", "display_name_ar"),
        };
        if (create) validateCreateModifierOptionInput({ ...input, currency: values.currency }, context.snapshot.businessProfile);
        else validateUpdateModifierOptionInput({ ...input, status: statusForService(values.status) }, context.snapshot.businessProfile);
        break;
      }
      case "Product Modifiers":
        if (create) {
          validateAttachModifierGroupInput({
            expectedProductVersion: 1,
            modifierGroupPublicId: work.endpoints.modifier_group_key ?? values.modifier_group_key ?? "",
            sortOrder: maybeInt(values.sort_order),
          });
        }
        break;
      case "Menus":
        if (create) {
          validateCreateDraftMenuInput({
            internalName: values.internal_name ?? "",
            locationIds: context.menuLocations(work.key),
            translations: {
              en: { displayName: values.display_name_en ?? "", description: values.description_en ?? null },
              ar: { displayName: values.display_name_ar ?? "", description: values.description_ar ?? null },
            },
          });
        } else {
          validateUpdateDraftMenuInput({
            expectedVersion: 1,
            internalName: values.internal_name,
            translations: {
              ...(values.display_name_en !== undefined ? { en: { displayName: values.display_name_en } } : {}),
              ...(values.display_name_ar !== undefined ? { ar: { displayName: values.display_name_ar } } : {}),
            },
          });
        }
        break;
      default:
        break;
    }
  } catch (error) {
    if (error instanceof CatalogueValidationError || error instanceof MenuValidationError) {
      return { severity: "error", code: "service_validation", params: { field: error.field ?? "", message: error.message } };
    }
    throw error;
  }
  return null;
}
