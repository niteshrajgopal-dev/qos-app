import { contractSheet, sheetSupport, type SupportedEntitySheet } from "@/lib/workbook/contract";
import type { ReviewOperation } from "@/lib/workbook/validation/model";

/* Per-sheet action matrix (QOS-194, decision D-ACTIONS). An action is
   supported only when a QOS service exists that QOS-217 can call for it.
   Everything else is classified unsupported with its owner, never silently
   mapped to something else. Flip a cell here once a service lands. */

export const WORKBOOK_ACTIONS = ["create", "update", "archive", "remove_link", "reset_to_central", "skip"] as const;
export type WorkbookAction = (typeof WORKBOOK_ACTIONS)[number];

type ActionSupport = { operation: ReviewOperation | "skip" } | { unsupported: string };

const SKIP = { operation: "skip" } as const;
const CREATE = { operation: "create" } as const;
const UPDATE = { operation: "update" } as const;
const ARCHIVE = { operation: "archive" } as const;
const REMOVE_LINK = { operation: "remove_link" } as const;

/** Locations are managed in Settings → Branches and provisioning (QOS-192); Branch rows only anchor references. */
export const BRANCHES_OWNER = "Settings → Branches (QOS-192)";

export const ACTION_MATRIX: Record<SupportedEntitySheet, Partial<Record<WorkbookAction, ActionSupport>>> = {
  Branches: { create: { unsupported: BRANCHES_OWNER }, update: { unsupported: BRANCHES_OWNER }, skip: SKIP },
  Categories: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  Products: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Product Categories": { create: CREATE, update: UPDATE, remove_link: REMOVE_LINK, skip: SKIP },
  Variants: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Branch Prices": { create: CREATE, update: UPDATE, reset_to_central: { operation: "reset_to_central" }, skip: SKIP },
  "Modifier Groups": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Modifier Options": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Product Modifiers": { create: CREATE, update: UPDATE, remove_link: REMOVE_LINK, skip: SKIP },
  Menus: { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Menu Branches": { create: CREATE, update: UPDATE, remove_link: REMOVE_LINK, skip: SKIP },
  "Menu Sections": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
  "Menu Items": { create: CREATE, update: UPDATE, archive: ARCHIVE, skip: SKIP },
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

/** Owner of a whole deferred or rejected sheet, when the dictionary has no entry for it. */
export function sheetOwner(sheet: string) {
  return sheetSupport(sheet) === "rejected" ? "Phase 3 (combos are rejected in Phase 2)" : "QOS-195–199 domain services; apply in QOS-200";
}
