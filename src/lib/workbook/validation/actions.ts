import {
  CHANNEL_PRICE_APPLY_OWNER,
  type ChannelSheetName,
} from "@/lib/workbook/channel-price-capabilities";
import { contractSheet, sheetSupport, type SupportedEntitySheet } from "@/lib/workbook/contract";
import type { ReviewOperation } from "@/lib/workbook/validation/model";

/* Per-sheet action matrix (QOS-194, decision D-ACTIONS). An action is
   supported only when a QOS service exists that QOS-217 can call for it.
   Everything else is classified unsupported with its owner, never silently
   mapped to something else. Flip a cell here once a service lands. */

export const WORKBOOK_ACTIONS = ["create", "update", "archive", "remove_link", "reset_to_central", "set", "skip"] as const;
export type WorkbookAction = (typeof WORKBOOK_ACTIONS)[number];

type ActionSupport = { operation: ReviewOperation | "skip" } | { unsupported: string };

const SKIP = { operation: "skip" } as const;
const CREATE = { operation: "create" } as const;
const UPDATE = { operation: "update" } as const;
const ARCHIVE = { operation: "archive" } as const;
const REMOVE_LINK = { operation: "remove_link" } as const;

/** Locations are managed in Settings → Branches and provisioning (QOS-192); Branch rows only anchor references. */
export const BRANCHES_OWNER = "Settings → Branches (QOS-192)";

export const MENUS_ARCHIVE_OWNER = "Menu editor (no menu archive service yet)";

export { CHANNEL_PRICE_APPLY_OWNER };

const CHANNEL_SHEETS: ReadonlySet<string> = new Set<ChannelSheetName>([
  "Sales Channels",
  "Variant Channel Prices",
  "Modifier Option Channel Prices",
]);

const CHANNEL_WRITE_UNSUPPORTED = { unsupported: CHANNEL_PRICE_APPLY_OWNER } as const;

export const ACTION_MATRIX: Record<SupportedEntitySheet, Partial<Record<WorkbookAction, ActionSupport>>> = {
  Branches: { create: { unsupported: BRANCHES_OWNER }, update: { unsupported: BRANCHES_OWNER }, skip: SKIP },
  Categories: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  Products: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Product Categories": { create: CREATE, update: UPDATE, remove_link: REMOVE_LINK, skip: SKIP },
  Variants: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Branch Prices": { create: CREATE, update: UPDATE, reset_to_central: { operation: "reset_to_central" }, skip: SKIP },
  // Catalogue services exist; workbook apply of v1.2 channel sheets is QOS-200.
  "Sales Channels": { skip: SKIP },
  "Variant Channel Prices": { set: CHANNEL_WRITE_UNSUPPORTED, reset_to_central: CHANNEL_WRITE_UNSUPPORTED, skip: SKIP },
  "Modifier Groups": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Modifier Options": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Modifier Option Channel Prices": { set: CHANNEL_WRITE_UNSUPPORTED, reset_to_central: CHANNEL_WRITE_UNSUPPORTED, skip: SKIP },
  "Product Modifiers": { create: CREATE, update: UPDATE, remove_link: REMOVE_LINK, skip: SKIP },
  // No service archives a menu (QOS-217, D-MENU-ARCHIVE); flip back when one lands.
  Menus: { create: CREATE, update: UPDATE, archive: { unsupported: MENUS_ARCHIVE_OWNER }, skip: SKIP },
  "Menu Branches": { create: CREATE, update: UPDATE, remove_link: REMOVE_LINK, skip: SKIP },
  "Menu Sections": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Menu Items": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  // QOS-200 Phase 2 domain services. Archive sets the record inactive (masters),
  // discards a draft (Recipes; an approved version is never changed) or leaves
  // the line, step or effect out of the draft's list (marked removed, never deleted).
  Units: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  Suppliers: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  Warehouses: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Inventory Categories": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  Ingredients: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  Recipes: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Recipe Lines": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Prep Steps": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Modifier Effects": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
};

export type ActionResolution =
  | { kind: "operation"; action: WorkbookAction; operation: ReviewOperation | "skip"; normalized: boolean }
  | { kind: "unsupported"; action: WorkbookAction; owner: string }
  | { kind: "invalid"; code: "action_required" | "action_unknown" | "action_not_allowed_for_sheet"; value: string; allowed: string };

/**
 * Resolves the `action` cell of a supported-sheet row against the contract's
 * allowed values and the service matrix. Case differences are accepted and
 * reported; blank, unknown and sheet-foreign actions are errors.
 */
export function resolveAction(sheet: SupportedEntitySheet, raw: string): ActionResolution {
  const allowed = contractSheet(sheet).columns.find((column) => column.key === "action")?.values ?? [];
  const text = raw.trim();
  if (!text) {
    // Sales Channels has no action column. Price-sheet exports leave action
    // blank to keep the current value. This leaf does not apply either; skip.
    if (CHANNEL_SHEETS.has(sheet)) {
      return { kind: "operation", action: "skip", operation: "skip", normalized: false };
    }
    return { kind: "invalid", code: "action_required", value: "", allowed: allowed.join(", ") };
  }
  const action = WORKBOOK_ACTIONS.find((candidate) => candidate === text.toLowerCase());
  if (!action) {
    return { kind: "invalid", code: "action_unknown", value: text, allowed: allowed.join(", ") };
  }
  const support = ACTION_MATRIX[sheet][action];
  if (!allowed.includes(action) || !support) {
    return { kind: "invalid", code: "action_not_allowed_for_sheet", value: text, allowed: allowed.join(", ") };
  }
  if ("unsupported" in support) {
    return { kind: "unsupported", action, owner: support.unsupported };
  }
  return { kind: "operation", action, operation: support.operation, normalized: action !== text };
}

/** Sheets whose rows are never reviewed for apply in this leaf. */
export function isUnsupportedSheet(sheet: string) {
  const support = sheetSupport(sheet);
  return support === "deferred" || support === "rejected";
}

export const COMBOS_OWNER = "Phase 3 (combos are rejected in Phase 2)";
export const PREP_TARGETS_OWNER = "Preparation targets: the prep-target service is not built yet";
export const EXTERNAL_MAPPINGS_OWNER = "Provider mappings: the POS connections service is not built yet";
export const OPENING_STOCK_OWNER = "Opening stock: posted through its own intake with confirmation, never by this import";
/** Owner of a deferred sheet with no owner of its own (none today). */
export const DEFERRED_SHEET_OWNER = "Kept for a later import increment";

/* Plain, ticket-free dispositions of the sheets this import keeps but never
   applies (QOS-200, D6). The review and apply panels show them. */
const SHEET_OWNERS: Record<string, string> = {
  "Prep Targets": PREP_TARGETS_OWNER,
  "External Mappings": EXTERNAL_MAPPINGS_OWNER,
  "Opening Stock": OPENING_STOCK_OWNER,
};

/** Owner of a whole deferred or rejected sheet, when the dictionary has no entry for it. */
export function sheetOwner(sheet: string) {
  if (sheetSupport(sheet) === "rejected") return COMBOS_OWNER;
  return SHEET_OWNERS[sheet] ?? DEFERRED_SHEET_OWNER;
}
