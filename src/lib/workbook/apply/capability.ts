import type { DbTransaction } from "@/lib/tenant/context";
import { contractSheet, type SupportedEntitySheet } from "@/lib/workbook/contract";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { isDeferredColumn } from "@/lib/workbook/validation/capability";
import type { ReviewDeferredField } from "@/lib/workbook/validation/model";

/* Field capabilities (QOS-217, decision D-CAPABILITY). Exactly the columns a
   handler sends to a catalogue service, per sheet. A proposed column outside
   this list and not deferred fails the row closed (`unsupported_field`),
   never a silent drop. Deferred values are reported with their owner and
   never sent anywhere unless a field extension claims them: the registry is
   where QOS-212–215 and the later QOS-200 handlers plug into the same engine
   and the same unit transaction. It is empty in this leaf. */

const MECHANICS = new Set(["action", "expected_revision", "clear_fields", "row_check"]);

export const FIELD_CAPABILITIES: Record<SupportedEntitySheet, readonly string[]> = {
  // Anchor only: locations are managed in Settings → Branches.
  Branches: [],
  Categories: ["internal_name", "display_name_en", "display_name_ar", "sort_order", "status"],
  Products: [
    "internal_name",
    "display_name_en",
    "display_name_ar",
    "description_en",
    "description_ar",
    "sku",
    "barcode",
    "nutrition_calories",
    "image_url",
    "status",
  ],
  "Product Categories": ["sort_order"],
  Variants: ["variant_label_en", "variant_label_ar", "is_default", "sort_order", "sku", "barcode", "amount_minor", "currency", "status"],
  "Branch Prices": ["amount_minor", "currency"],
  "Modifier Groups": ["internal_name", "display_name_en", "display_name_ar", "min_selections", "max_selections", "status"],
  "Modifier Options": [
    "display_name_en",
    "display_name_ar",
    "price_minor",
    "currency",
    "is_default",
    "allows_quantity",
    "max_quantity",
    "sort_order",
    "status",
  ],
  "Product Modifiers": ["sort_order"],
  Menus: ["internal_name", "display_name_en", "display_name_ar", "description_en", "description_ar", "status"],
  "Menu Branches": [],
  "Menu Sections": ["internal_name", "display_name_en", "display_name_ar", "sort_order", "archived"],
  "Menu Items": ["sort_order", "archived"],
};

/** Columns that identify a row rather than carry a value: its key, QOS id, references and read-only context. */
function isIdentityColumn(sheet: string, column: string) {
  const definition = contractSheet(sheet).columns.find((candidate) => candidate.key === column);
  if (!definition) return false;
  return Boolean(definition.isKey) || Boolean(definition.readonly) || definition.type === "reference";
}

/** The data columns a row asks a service to write: every proposed value on create, the changed ones on update. */
export function proposedColumns(row: { sheet: string; operation: string | null; after: Record<string, string> | null; changes: Array<{ column: string }> }) {
  const columns = row.operation === "create" ? Object.keys(row.after ?? {}) : row.changes.map((change) => change.column);
  return [...new Set(columns)].filter((column) => !MECHANICS.has(column) && !isIdentityColumn(row.sheet, column));
}

/** Fails closed on a proposed column no handler persists. Deferred columns are never proposed changes, but are excluded here too. */
export function assertCapabilities(row: Parameters<typeof proposedColumns>[0]) {
  const unknown = proposedColumns(row).filter(
    (column) => !FIELD_CAPABILITIES[row.sheet as SupportedEntitySheet]?.includes(column) && !isDeferredColumn(row.sheet, column),
  );
  if (unknown.length > 0) {
    throw new ApplyUnitError("unsupported_field", `No handler saves ${unknown.join(", ")} on ${row.sheet}.`, { field: unknown[0] });
  }
}

/* ------------------------------------------------------------------ */
/* Field extensions                                                    */
/* ------------------------------------------------------------------ */

export type FieldExtensionContext = {
  tx: DbTransaction;
  tenantId: string;
  sheet: string;
  column: string;
  value: string;
  /** Public id of the record the row saved or updated. */
  targetPublicId: string;
  actorSubject: string;
};

export type FieldExtension = {
  sheet: string;
  column: string;
  owner: string;
  /** Runs inside the unit's transaction, after the sheet handler. */
  apply: (context: FieldExtensionContext) => Promise<void>;
};

const EXTENSIONS = new Map<string, FieldExtension>();

function extensionId(sheet: string, column: string) {
  return `${sheet}\u0000${column}`;
}

/** Registers a handler for a deferred column. None is registered in QOS-217. */
export function registerFieldExtension(extension: FieldExtension) {
  EXTENSIONS.set(extensionId(extension.sheet, extension.column), extension);
  return () => {
    EXTENSIONS.delete(extensionId(extension.sheet, extension.column));
  };
}

export function fieldExtensionFor(sheet: string, column: string) {
  return EXTENSIONS.get(extensionId(sheet, column)) ?? null;
}

/** Deferred values of a row split into those an extension saves and those that stay with the plan. */
export function splitDeferred(sheet: string, deferred: ReviewDeferredField[]) {
  const extended: Array<{ field: ReviewDeferredField; extension: FieldExtension }> = [];
  const kept: ReviewDeferredField[] = [];
  for (const field of deferred) {
    const extension = fieldExtensionFor(sheet, field.column);
    if (extension) extended.push({ field, extension });
    else kept.push(field);
  }
  return { extended, kept };
}
