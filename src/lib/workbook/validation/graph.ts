import type { ReviewClassification } from "@/lib/workbook/validation/model";
import { idColumnOf, type ReviewSnapshot } from "@/lib/workbook/validation/snapshot";
import { addDiagnostic, refOf, type WorkRow } from "@/lib/workbook/validation/work";

/* Dependency graph (QOS-194, plan section 2.7). Edges come from the
   contract's `ref` columns. The contract's sheet order is already a valid
   resolution order: branches anchor, then categories, products, links,
   variants, branch prices, modifier groups and options, menus, menu branches,
   sections and items. A reference resolves to a row of this workbook, or, in
   a QOS export namespace only, to an existing record with that public id.
   Nothing is fuzzy-matched and no missing entity is invented. */

/** Link sheets and the two references that identify a link. */
export const LINK_ENDPOINTS: Record<string, readonly [string, string]> = {
  "Product Categories": ["product_key", "category_key"],
  "Product Modifiers": ["product_key", "modifier_group_key"],
  "Branch Prices": ["variant_key", "branch_key"],
  "Menu Branches": ["menu_key", "branch_key"],
  "Menu Items": ["section_key", "product_key"],
};

export function pairKey(first: string, second: string) {
  return `${first}\u0000${second}`;
}

/** Existing links by their verified endpoints: sheet → endpoint pair → link id. */
export function linkPairIndex(snapshot: ReviewSnapshot) {
  const index = new Map<string, Map<string, string>>();
  for (const [sheet, [first, second]] of Object.entries(LINK_ENDPOINTS)) {
    const pairs = new Map<string, string>();
    const idColumn = idColumnOf(sheet);
    for (const row of snapshot.records[sheet as keyof ReviewSnapshot["records"]].values()) {
      pairs.set(pairKey(row[first] ?? "", row[second] ?? ""), row[idColumn]!);
    }
    index.set(sheet, pairs);
  }
  return index;
}

export type KeyIndex = Map<string, Map<string, WorkRow[]>>;

export function buildKeyIndex(works: WorkRow[]): KeyIndex {
  const index: KeyIndex = new Map();
  for (const work of works) {
    if (!work.key) continue;
    const bySheet = index.get(work.sheet) ?? new Map<string, WorkRow[]>();
    bySheet.set(work.key, [...(bySheet.get(work.key) ?? []), work]);
    index.set(work.sheet, bySheet);
  }
  return index;
}

/**
 * Resolves every reference cell of a row. On an unsupported (deferred) row a
 * failed reference is a warning: those rows are shown, never applied, and
 * never block supported rows.
 */
export function resolveReferences(work: WorkRow, keys: KeyIndex, snapshot: ReviewSnapshot, keysVerified: boolean) {
  const severity = work.supported ? "error" : "warning";
  for (const column of work.def.columns) {
    if (!column.ref) continue;
    const value = (work.input.values[column.key] ?? "").trim();
    if (!value) continue;
    const refSheet = column.ref.sheet;

    if (refSheet === "Branches") {
      // Branch keys are location public ids; permission is checked on the row that uses them.
      if (snapshot.permittedBranches.has(value)) {
        work.endpoints[column.key] = value;
        work.branch = { publicId: value, name: snapshot.permittedBranches.get(value)! };
      } else if (snapshot.allBranchPublicIds.has(value)) {
        work.endpoints[column.key] = null;
        addDiagnostic(work, { severity, code: "branch_not_permitted", column: column.key, params: { branch: value } });
      } else {
        work.endpoints[column.key] = null;
        addDiagnostic(work, { severity, code: "unresolved_reference", column: column.key, params: { refSheet, key: value } });
      }
      continue;
    }

    const rows = keys.get(refSheet)?.get(value);
    if (rows && rows.length > 0) {
      const target = rows[0]!;
      work.edges.push({ column: column.key, target });
      work.endpoints[column.key] = target.identity.targetPublicId;
      continue;
    }

    const records = snapshot.records[refSheet as keyof ReviewSnapshot["records"]];
    if (keysVerified && records?.has(value)) {
      work.endpoints[column.key] = value;
      addDiagnostic(work, { severity: "info", code: "resolved_existing", column: column.key, params: { refSheet, key: value } });
      continue;
    }

    work.endpoints[column.key] = null;
    addDiagnostic(work, { severity, code: "unresolved_reference", column: column.key, params: { refSheet, key: value } });
  }
}

const PROPOSING: ReadonlySet<ReviewClassification> = new Set(["create", "update", "unchanged"]);

/** A row others may depend on: it will exist after apply (proposed) or already exists (skipped with a verified target). */
export function isAnchor(work: WorkRow) {
  if (work.classification && PROPOSING.has(work.classification)) return true;
  return work.classification === "skipped" && Boolean(work.identity.targetPublicId);
}

/**
 * Blocking in resolution order: a proposed row whose referenced row is
 * invalid, conflicting, blocked, unsupported or excluded becomes Blocked and
 * points at the responsible row; that row lists what it blocks.
 */
export function propagateBlocking(works: WorkRow[]) {
  for (const work of works) {
    if (!work.supported || !work.classification || !PROPOSING.has(work.classification)) continue;
    const responsible = work.edges.filter((edge) => !isAnchor(edge.target));
    if (responsible.length === 0) continue;
    work.classification = "blocked";
    work.operation = null;
    for (const edge of responsible) {
      const ref = refOf(edge.target);
      work.blockedBy.push(ref);
      edge.target.blocks.push(refOf(work));
      addDiagnostic(work, {
        severity: "error",
        code: "blocked_by_dependency",
        column: edge.column,
        params: { refSheet: ref.sheet, row: ref.row, key: ref.key, reason: edge.target.classification ?? "invalid" },
        responsible: ref,
      });
    }
  }
}
