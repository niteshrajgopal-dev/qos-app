import {
  CHANNEL_PRICE_APPLY_OWNER,
  channelFieldCapability,
  type ChannelSheetName,
} from "@/lib/workbook/channel-price-capabilities";
import { contractSheet, isDeferredField, sheetSupport } from "@/lib/workbook/contract";
import { capabilityFor, SOURCE_MAP_SHEET } from "@/lib/workbook/dictionary";
import {
  PRODUCT_MODIFIER_ASSIGNMENT_CAPABILITIES,
  type ProductModifierAssignmentField,
} from "@/lib/workbook/product-modifier-assignment-capabilities";
import { sheetOwner } from "@/lib/workbook/validation/actions";
import type { FieldDecision, ReviewInput } from "@/lib/workbook/validation/model";

/* Field decisions (QOS-194, decision D-CAPABILITY): for every column that
   carries at least one value, whether the review checked it against QOS
   records (validated; applying is QOS-217), recognised it but QOS has
   nowhere to keep it yet (deferred, with the owning leaf), refused the sheet
   (rejected), or used it to steer the review (mechanics). The dictionary
   JSON is read, never edited, and nothing is ever called persistable. */

export const VALIDATED_OWNER = "QOS-194 review; apply in QOS-217";
export const MECHANICS_OWNER = "QOS-194 review";

const MECHANICS_COLUMNS = new Set(["action", "expected_revision", "clear_fields", "row_check"]);

/** Source text kept beside a column QOS already reads (price, option price, ingredient cost, tax rate). Provenance, not an extra value. */
export const PROVENANCE_COPIES = new Set(["price", "tax", "option_price", "ingredient_cost"]);

/** Assignment-policy columns QOS-212 can store, but workbook apply is QOS-200's. */
export const PRODUCT_MODIFIER_POLICY_APPLY_OWNER = "QOS-200 apply";

export { CHANNEL_PRICE_APPLY_OWNER };

function productModifierAssignmentCapability(sheet: string, column: string) {
  if (sheet !== "Product Modifiers") return undefined;
  return PRODUCT_MODIFIER_ASSIGNMENT_CAPABILITIES[column as ProductModifierAssignmentField];
}

function channelPriceApplyDeferred(sheet: string, column: string) {
  if (sheet !== "Sales Channels" && sheet !== "Variant Channel Prices" && sheet !== "Modifier Option Channel Prices") {
    return false;
  }
  const capability = channelFieldCapability(sheet as ChannelSheetName, column);
  // Persistable values and review-only lookup fields are applied by QOS-200.
  return capability === "persistable" || capability === "review_only";
}

/** Owner of a deferred value: the dictionary 1.1 entry when there is one, else the owner of its sheet. */
export function deferredOwner(sheet: string, column: string) {
  const fromDictionary = capabilityFor(sheet, column)?.owner;
  if (fromDictionary) return fromDictionary;
  const assignment = productModifierAssignmentCapability(sheet, column);
  if (assignment?.apply === "QOS-200") return PRODUCT_MODIFIER_POLICY_APPLY_OWNER;
  if (channelPriceApplyDeferred(sheet, column)) return CHANNEL_PRICE_APPLY_OWNER;
  return sheetOwner(sheet);
}

/** Whether a column of a supported sheet is not applied by this leaf.
    Includes dictionary/contract deferred fields, and the v1.1 Product
    Modifiers policy columns whose workbook apply belongs to QOS-200. */
export function isDeferredColumn(sheet: string, column: string) {
  if (sheetSupport(sheet) !== "supported") return true;
  const definition = contractSheet(sheet).columns.find((candidate) => candidate.key === column);
  if (definition && isDeferredField(definition)) return true;
  if (capabilityFor(sheet, column)?.class === "deferred") return true;
  const assignment = productModifierAssignmentCapability(sheet, column);
  if (assignment?.apply === "QOS-200") return true;
  return channelPriceApplyDeferred(sheet, column);
}

export function decideField(sheet: string, column: string): Omit<FieldDecision, "rowsWithValues"> {
  const dictionaryClass = capabilityFor(sheet, column)?.class ?? null;
  if (sheet === SOURCE_MAP_SHEET) {
    return { sheet, column, dictionaryClass, decision: "deferred", owner: deferredOwner(sheet, column) };
  }
  const support = sheetSupport(sheet);
  if (support === "rejected") {
    return { sheet, column, dictionaryClass, decision: "rejected", owner: sheetOwner(sheet) };
  }
  if (MECHANICS_COLUMNS.has(column)) {
    return { sheet, column, dictionaryClass, decision: "mechanics", owner: MECHANICS_OWNER };
  }
  if (isDeferredColumn(sheet, column)) {
    return { sheet, column, dictionaryClass, decision: "deferred", owner: deferredOwner(sheet, column) };
  }
  return { sheet, column, dictionaryClass, decision: "validated", owner: VALIDATED_OWNER };
}

/**
 * Decisions for every column with at least one value in the upload, in sheet
 * order. Values a source adapter kept beside the canonical columns (Foodics
 * channel prices, cost, selling metadata) are listed under the Source Map,
 * as #93 classifies them; exact-text copies of read columns are not.
 */
export function computeFieldDecisions(input: Pick<ReviewInput, "sheets">): FieldDecision[] {
  const counts = new Map<string, FieldDecision>();
  const count = (sheet: string, column: string) => {
    const id = `${sheet}\u0000${column}`;
    const existing = counts.get(id);
    if (existing) {
      existing.rowsWithValues += 1;
      return;
    }
    counts.set(id, { ...decideField(sheet, column), rowsWithValues: 1 });
  };
  for (const sheet of input.sheets) {
    for (const row of sheet.rows) {
      for (const [column, value] of Object.entries(row.values)) {
        if (value.trim()) count(sheet.sheet, column);
      }
      for (const field of Object.keys(row.source?.preserved ?? {})) {
        if (!PROVENANCE_COPIES.has(field)) count(SOURCE_MAP_SHEET, field);
      }
    }
  }
  return [...counts.values()];
}
