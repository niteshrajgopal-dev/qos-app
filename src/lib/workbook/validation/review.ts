import { contractSheet, SUPPORTED_ENTITY_SHEETS, WORKBOOK_CONTRACT } from "@/lib/workbook/contract";
import type { WorkbookIssue } from "@/lib/workbook/reader";
import { isUnsupportedSheet, resolveAction, sheetOwner } from "@/lib/workbook/validation/actions";
import { buildKeyIndex, LINK_ENDPOINTS, linkPairIndex, pairKey, propagateBlocking, resolveReferences } from "@/lib/workbook/validation/graph";
import {
  candidateOf,
  ENTITY_SHEETS,
  labelOf,
  looseNames,
  nameCandidates,
  namesCollide,
  PARENT_COLUMN,
  recordLabel,
  recordsInScope,
  variantsOfProduct,
} from "@/lib/workbook/validation/identity";
import {
  ACKNOWLEDGEMENT_KINDS,
  REVIEW_CLASSIFICATIONS,
  type PlanAcknowledgement,
  type PlanDecision,
  type RequiredAcknowledgement,
  type ReviewClassification,
  type ReviewCounts,
  type ReviewDiagnostic,
  type ReviewContext,
  type ReviewInput,
  type ReviewInputMeta,
  type ReviewRow,
  type RowDecision,
  type WorkbookReview,
} from "@/lib/workbook/validation/model";
import { computeFieldDecisions, isDeferredColumn } from "@/lib/workbook/validation/capability";
import { ACTIVE_FLAG_SHEETS, ARCHIVE_OPERATION_SHEETS, isDraftRecipeRecord, RECIPE_CHILD_SHEETS, standardUnitOfRow } from "@/lib/workbook/phase2-values";
import { enforcePhase2, familyOfRecipeRow, referenced, standardUnitCandidates } from "@/lib/workbook/validation/phase2-review";
import { checkApplyParity, checkConditionalInputs, checkService, deferredFieldsOf, dropImportStatus, typeRow, type ServiceContext } from "@/lib/workbook/validation/rules";
import { idColumnOf, RECIPE_FAMILY_LINKS, type ReviewSnapshot } from "@/lib/workbook/validation/snapshot";
import { addDiagnostic, fromSource, hasErrors, type WorkRow } from "@/lib/workbook/validation/work";

/* The review engine (QOS-194). Pure and synchronous: one normalised input,
   one snapshot of the tenant's current records and the operator's
   decisions in; every row classified with real before/after values,
   diagnostics and dependencies out. It never writes. Names never confirm
   identity: a row becomes an Update of an existing record only through a
   QOS id, a source link (product link or typed workbook link) or a stored
   decision. */

/* qos217.1: typed workbook source links are verified identities and three
   service-parity rules refuse what apply cannot do (QOS-217). qos200.1: the
   Phase 2 sheets are reviewed for apply (QOS-200). A plan reviewed under an
   older version must be re-reviewed before apply. */
export const REVIEW_ENGINE_VERSION = "qos200.1";

type Row = Record<string, string>;

const MECHANICS = new Set(["action", "expected_revision", "clear_fields", "row_check"]);
const SHEET_ORDER = new Map(WORKBOOK_CONTRACT.sheets.map((sheet, index) => [sheet.name, index]));
const SUPPORTED = new Set<string>(SUPPORTED_ENTITY_SHEETS);
const ARCHIVE_FLAG_SHEETS = new Set(["Menu Sections", "Menu Items"]);
const PROPOSING = new Set<ReviewClassification>(["create", "update", "unchanged"]);

function decisionId(sheet: string, row: number) {
  return `${sheet}\u0000${row}`;
}

function isRowDecision(decision: PlanDecision): decision is RowDecision {
  return "row" in decision;
}

function isAcknowledgement(decision: PlanDecision): decision is PlanAcknowledgement {
  return (ACKNOWLEDGEMENT_KINDS as readonly string[]).includes(decision.kind);
}

/** Row decisions addressed by key follow their row into an edited upload; otherwise by sheet and row. */
function indexDecisions(works: WorkRow[], decisions: PlanDecision[]) {
  const byId = new Map<string, RowDecision>();
  for (const decision of decisions.filter(isRowDecision)) {
    const target = decision.key
      ? works.find((work) => work.sheet === decision.sheet && work.key === decision.key)
      : works.find((work) => work.sheet === decision.sheet && work.input.row === decision.row);
    if (!target) continue;
    byId.set(decisionId(target.sheet, target.input.row), { ...decision, row: target.input.row, key: target.key });
  }
  return byId;
}

function newWork(sheet: string, input: ReviewInput["sheets"][number]["rows"][number], namespace: string, keysVerified: boolean): WorkRow {
  const def = contractSheet(sheet);
  const key = (input.values[def.columns[0]!.key] ?? "").trim();
  return {
    sheet,
    def,
    input,
    key,
    supported: SUPPORTED.has(sheet),
    requestedAction: (input.values.action ?? "").trim(),
    op: null,
    typed: {},
    clears: [],
    diagnostics: [],
    classification: null,
    operation: null,
    identity: { namespace, keyVerified: keysVerified, targetPublicId: null, targetRevision: null, via: null },
    before: null,
    after: null,
    changes: [],
    deferredFields: [],
    decision: null,
    edges: [],
    endpoints: {},
    blockedBy: [],
    blocks: [],
    excluded: false,
  };
}

/* Reader issues belong to the row they were found on: by sheet and row in a
   QOS workbook, by source cell (or source row) in a converted one. */
function attachParseIssues(works: WorkRow[], issues: WorkbookIssue[], converted: boolean) {
  for (const issue of issues) {
    if (!issue.sheet || !issue.row) continue;
    const cell = issue.params?.cell ? `${issue.sheet}!${issue.params.cell}` : undefined;
    let targets: WorkRow[];
    if (converted) {
      const onRow = works.filter((work) => work.input.source?.sheet === issue.sheet && work.input.source?.row === issue.row);
      const onCell = cell ? onRow.filter((work) => Object.values(work.input.source!.cells).includes(cell)) : [];
      targets = onCell.length > 0 ? onCell : onRow;
    } else {
      targets = works.filter((work) => work.sheet === issue.sheet && work.input.row === issue.row);
    }
    for (const work of targets) {
      const diagnostic: ReviewDiagnostic = {
        severity: issue.severity === "error" && !work.supported ? "warning" : issue.severity,
        code: issue.code,
        ...(issue.column ? { column: issue.column } : {}),
        ...(cell ? { cell } : {}),
        ...(issue.params ? { params: issue.params } : {}),
      };
      work.diagnostics.push(diagnostic);
    }
  }
}

function setTarget(work: WorkRow, publicId: string, via: NonNullable<WorkRow["identity"]["via"]>, record: Row | undefined) {
  work.identity.targetPublicId = publicId;
  work.identity.via = via;
  work.identity.targetRevision = record?.expected_revision || null;
  work.before = record ? { ...record } : null;
}

function rejectDecision(work: WorkRow, decision: RowDecision, reason: string) {
  addDiagnostic(work, {
    severity: "warning",
    code: "decision_rejected",
    params: { kind: decision.kind, reason, ...("targetPublicId" in decision ? { target: decision.targetPublicId } : {}) },
  });
  work.decision = null;
}

type Engine = {
  input: ReviewInput;
  snapshot: ReviewSnapshot;
  works: WorkRow[];
  decisions: Map<string, RowDecision>;
  pairs: ReturnType<typeof linkPairIndex>;
  service: ServiceContext;
};

function recordsOf(engine: Engine, sheet: string) {
  return engine.snapshot.records[sheet as keyof ReviewSnapshot["records"]];
}

/** Existing parent a scoped row belongs to: its endpoint, or null when the parent is new or unresolved. */
function parentPublicId(work: WorkRow) {
  const column = PARENT_COLUMN[work.sheet];
  return column ? (work.endpoints[column] ?? null) : null;
}

function belongsToParent(work: WorkRow, record: Row) {
  const column = PARENT_COLUMN[work.sheet];
  if (!column) return true;
  const parent = work.endpoints[column];
  return parent !== null && parent !== undefined && record[column] === parent;
}

/** A target named by id must exist, in scope, and (for branches) be permitted. */
function checkIdTarget(engine: Engine, work: WorkRow, publicId: string): Row | null {
  if (work.sheet === "Branches") {
    if (engine.snapshot.permittedBranches.has(publicId)) {
      work.branch = { publicId, name: engine.snapshot.permittedBranches.get(publicId)! };
      return recordsOf(engine, "Branches").get(publicId) ?? { branch_key: publicId, qos_location_id: publicId, name: work.branch.name };
    }
    addDiagnostic(work, {
      severity: "error",
      code: engine.snapshot.allBranchPublicIds.has(publicId) ? "branch_not_permitted" : "target_not_found",
      column: idColumnOf(work.sheet),
      params: { id: publicId, branch: publicId },
    });
    return null;
  }
  const record = recordsOf(engine, work.sheet).get(publicId);
  const parentKnown = Boolean(PARENT_COLUMN[work.sheet] && work.endpoints[PARENT_COLUMN[work.sheet]!]);
  if (work.sheet === "Warehouses" && record && parentKnown && !belongsToParent(work, record)) {
    // A warehouse stays with its branch (QOS-196); moving it is refused, not read as another record.
    addDiagnostic(work, {
      severity: "error",
      code: "service_validation",
      column: "branch_key",
      params: { field: "branch_key", reason: "location_immutable", message: "A warehouse never moves; archive it and add one at the new branch." },
    });
    return null;
  }
  // D4: a line, step or effect of an approved version still belongs to the version its draft was saved from.
  const parentEdge = PARENT_COLUMN[work.sheet] ? work.edges.find((edge) => edge.column === PARENT_COLUMN[work.sheet]) : undefined;
  const frozenParent = Boolean(record && parentEdge?.target.frozenSource && record[PARENT_COLUMN[work.sheet]!] === parentEdge.target.frozenSource);
  if (!record || (parentKnown && !belongsToParent(work, record) && !frozenParent)) {
    addDiagnostic(work, { severity: "error", code: "target_not_found", column: idColumnOf(work.sheet), params: { id: publicId } });
    return null;
  }
  return record;
}

/** The QOS id a row names: its id column, or its key when keys are verified export keys. */
function namedId(engine: Engine, work: WorkRow) {
  const id = work.typed[idColumnOf(work.sheet)];
  if (id) return id;
  if (engine.input.keysVerified && ENTITY_SHEETS.has(work.sheet) && recordsOf(engine, work.sheet).has(work.key)) return work.key;
  return "";
}

function applyMatchDecision(engine: Engine, work: WorkRow, decision: Extract<RowDecision, { kind: "match_existing" }>) {
  if (!ENTITY_SHEETS.has(work.sheet) || work.sheet === "Branches") {
    rejectDecision(work, decision, "not_matchable");
    return false;
  }
  const record = recordsOf(engine, work.sheet).get(decision.targetPublicId);
  if (!record || (PARENT_COLUMN[work.sheet] && !belongsToParent(work, record))) {
    rejectDecision(work, decision, "target_not_found");
    return false;
  }
  work.decision = decision;
  setTarget(work, decision.targetPublicId, "decision", record);
  return true;
}

function conflict(work: WorkRow, code: ReviewDiagnostic["code"], candidates: WorkRow["candidates"], params: Record<string, string | number> = {}) {
  work.classification = "conflicting";
  work.candidates = candidates;
  addDiagnostic(work, { severity: "error", code, params: { candidates: candidates?.length ?? 0, ...params } });
}

/* ------------------------------------------------------------------ */
/* Identity per row                                                    */
/* ------------------------------------------------------------------ */

/** The record a typed workbook source link (QOS-217) names for this row's key, when it exists in scope. */
function typedLinkTarget(engine: Engine, work: WorkRow): string | null {
  const publicId = engine.snapshot.typedLinks.get(work.sheet)?.get(work.key);
  if (!publicId) return null;
  const record = recordsOf(engine, work.sheet)?.get(publicId);
  if (!record || (PARENT_COLUMN[work.sheet] && !belongsToParent(work, record))) return null;
  return publicId;
}

/**
 * D4 (QOS-200): an approved recipe version (or its line, step or effect) is
 * never changed; an earlier apply saved the row to a draft and moved the
 * row's typed link there. A row that still names the approved record by id
 * is compared against that draft, so a retry or re-upload changes nothing.
 */
function draftOfFrozen(engine: Engine, work: WorkRow, id: string): string | null {
  if (work.sheet !== "Recipes" && !RECIPE_CHILD_SHEETS.has(work.sheet)) return null;
  const versionOf = (row: Row | undefined) =>
    work.sheet === "Recipes" ? row : row ? engine.snapshot.records.Recipes.get(row.recipe_version_key ?? "") : undefined;
  const named = versionOf(recordsOf(engine, work.sheet).get(id));
  if (named && isDraftRecipeRecord(named)) return null;
  // The row's own key, or a key that is the frozen record's id, followed the draft saved from it.
  const links = engine.snapshot.typedLinks.get(work.sheet);
  for (const linked of [links?.get(work.key), links?.get(id)]) {
    if (!linked || linked === id || !recordsOf(engine, work.sheet).has(linked)) continue;
    if (isDraftRecipeRecord(versionOf(recordsOf(engine, work.sheet).get(linked)))) return linked;
  }
  return null;
}

/** Whether `choice` is the open draft of the family whose approved version `id` is (a Recipes row only). */
function openDraftChoice(engine: Engine, work: WorkRow, id: string, choice: string) {
  if (work.sheet !== "Recipes" || choice === id) return false;
  const named = recordsOf(engine, "Recipes").get(id);
  const chosen = recordsOf(engine, "Recipes").get(choice);
  return Boolean(named && chosen && !isDraftRecipeRecord(named) && isDraftRecipeRecord(chosen) && named.recipe_key === chosen.recipe_key);
}

/** A key QOS linked on an earlier apply is the same record: compare against it, never create it again. */
function followTypedLink(engine: Engine, work: WorkRow, linked: string, decision: RowDecision | undefined): "resolved" {
  const draft = draftOfFrozen(engine, work, linked);
  if (draft) work.frozenSource ??= linked;
  const publicId = draft ?? linked;
  if (decision?.kind === "match_existing" && decision.targetPublicId === publicId) {
    work.decision = decision;
  } else if (decision) {
    rejectDecision(work, decision, "linked");
  }
  setTarget(work, publicId, "source_link", recordsOf(engine, work.sheet).get(publicId));
  return "resolved";
}

function resolveEntityTarget(engine: Engine, work: WorkRow, decision: RowDecision | undefined): "resolved" | "settled" {
  const isCreate = work.op === "create";
  const id = namedId(engine, work);

  if (isCreate) {
    if (work.typed[idColumnOf(work.sheet)]) {
      work.classification = "invalid";
      addDiagnostic(work, { severity: "error", code: "create_with_id", column: idColumnOf(work.sheet), params: { id: work.typed[idColumnOf(work.sheet)]! } });
      return "settled";
    }
    const typedLinked = typedLinkTarget(engine, work);
    if (typedLinked) {
      return followTypedLink(engine, work, typedLinked, decision);
    }
    if (decision?.kind === "match_existing") {
      return applyMatchDecision(engine, work, decision) ? "resolved" : resolveCreateConflicts(engine, work, undefined);
    }
    return resolveCreateConflicts(engine, work, decision);
  }

  if (id) {
    if (decision?.kind === "match_existing" && openDraftChoice(engine, work, id, decision.targetPublicId)) {
      // D4: the operator chose the family's open draft for a row that names its approved version.
      work.frozenSource = id;
      if (applyMatchDecision(engine, work, decision)) return "resolved";
    }
    if (decision?.kind === "match_existing" && decision.targetPublicId !== id) rejectDecision(work, decision, "row_has_id");
    const draft = draftOfFrozen(engine, work, id);
    if (draft) {
      work.frozenSource = id;
      return followTypedLink(engine, work, draft, undefined);
    }
    const record = checkIdTarget(engine, work, id);
    if (!record) {
      work.classification = "invalid";
      return "settled";
    }
    setTarget(work, id, "qos_id", record);
    return "resolved";
  }
  if (work.op === "skip") {
    return "settled";
  }
  const typedLinked = typedLinkTarget(engine, work);
  if (typedLinked) {
    return followTypedLink(engine, work, typedLinked, decision);
  }
  if (decision?.kind === "match_existing" && applyMatchDecision(engine, work, decision)) {
    return "resolved";
  }
  const linked = work.sheet === "Products" ? engine.snapshot.sourceLinks.get(work.key) : undefined;
  if (linked && recordsOf(engine, "Products").has(linked)) {
    setTarget(work, linked, "source_link", recordsOf(engine, "Products").get(linked));
    return "resolved";
  }
  const candidates = nameCandidates(engine.snapshot, work.sheet, parentPublicId(work), work.input.values);
  if (candidates.length > 0) {
    conflict(work, "update_target_unresolved", candidates);
  } else {
    work.classification = "invalid";
    addDiagnostic(work, { severity: "error", code: "update_requires_id", column: idColumnOf(work.sheet) });
  }
  return "settled";
}

/**
 * Existing records a new row could be: loose name matches in scope, plus
 * (QOS-200) an existing standard unit of the same code. A Recipes row whose
 * family is already known is a new version of it, not a name collision.
 */
function createCandidates(engine: Engine, work: WorkRow) {
  if (work.sheet === "Recipes" && familyOfRecipeRow(work, engine.snapshot, engine.input.keysVerified)) return [];
  const candidates = nameCandidates(engine.snapshot, work.sheet, parentPublicId(work), work.input.values);
  if (work.sheet === "Units") {
    for (const candidate of standardUnitCandidates(engine.snapshot, work.typed)) {
      if (!candidates.some((entry) => entry.publicId === candidate.publicId)) candidates.push(candidate);
    }
  }
  return candidates;
}

/** A create row is a Create only when nothing existing could be the same record; otherwise it waits for a decision. */
function resolveCreateConflicts(engine: Engine, work: WorkRow, decision: RowDecision | undefined): "resolved" | "settled" {
  const createNew = decision?.kind === "create_new";
  const products = recordsOf(engine, "Products");
  const linkedId =
    work.sheet === "Products" ? engine.snapshot.sourceLinks.get(work.key) : undefined;
  const keyIsExisting = engine.input.keysVerified && recordsOf(engine, work.sheet)?.has(work.key) ? work.key : undefined;
  const linked = (linkedId && products.has(linkedId) ? linkedId : undefined) ?? keyIsExisting;

  if (linked) {
    if (decision?.kind === "use_linked_record") {
      work.decision = decision;
      setTarget(work, linked, linkedId ? "source_link" : "qos_id", recordsOf(engine, work.sheet).get(linked));
      return "resolved";
    }
    if (!createNew) {
      conflict(work, "key_already_linked", [candidateOf(engine.snapshot, work.sheet, linked, "linked")], { id: linked });
      return "settled";
    }
  } else if (decision?.kind === "use_linked_record") {
    rejectDecision(work, decision, "no_link");
  }

  if (work.sheet === "Variants" && parentPublicId(work)) {
    const variants = variantsOfProduct(engine.snapshot, parentPublicId(work)!);
    if (variants.length >= 2 && !createNew) {
      conflict(
        work,
        "variant_target_required",
        variants.map(([publicId]) => candidateOf(engine.snapshot, "Variants", publicId, "variant_target")),
        { product: parentPublicId(work)! },
      );
      return "settled";
    }
  }

  const candidates = createCandidates(engine, work);
  if (candidates.length > 0 && !createNew) {
    conflict(work, "name_collision", candidates);
    return "settled";
  }

  if (createNew) {
    if (linked || candidates.length > 0 || work.sheet === "Variants") {
      work.decision = decision!;
      work.acknowledgedCollision = Boolean(linked || candidates.length > 0 || work.sheet === "Variants");
      if (candidates.length > 0) work.candidates = candidates;
    } else {
      rejectDecision(work, decision!, "nothing_to_acknowledge");
    }
  } else if (decision && decision.kind !== "exclude") {
    rejectDecision(work, decision, "not_applicable");
  }
  work.classification = "create";
  work.operation = "create";
  return "settled";
}

function resolveLinkTarget(engine: Engine, work: WorkRow): "resolved" | "settled" {
  const [first, second] = LINK_ENDPOINTS[work.sheet]!;
  const a = work.endpoints[first] ?? null;
  const b = work.endpoints[second] ?? null;
  const idColumn = idColumnOf(work.sheet);
  const id = work.typed[idColumn];
  const existingPair = a && b ? engine.pairs.get(work.sheet)?.get(pairKey(a, b)) : undefined;

  if (work.op === "create") {
    if (id) {
      work.classification = "invalid";
      addDiagnostic(work, { severity: "error", code: "create_with_id", column: idColumn, params: { id } });
      return "settled";
    }
    if (existingPair) {
      // Both ends are verified records and they are already linked: compare, never duplicate.
      setTarget(work, existingPair, "endpoints", recordsOf(engine, work.sheet).get(existingPair));
      addDiagnostic(work, { severity: "info", code: "resolved_existing", params: { refSheet: work.sheet, key: existingPair } });
      return "resolved";
    }
    work.classification = "create";
    work.operation = "create";
    return "settled";
  }

  if (id) {
    const record = recordsOf(engine, work.sheet).get(id);
    if (!record) {
      work.classification = "invalid";
      addDiagnostic(work, { severity: "error", code: "target_not_found", column: idColumn, params: { id } });
      return "settled";
    }
    setTarget(work, id, "qos_id", record);
    return "resolved";
  }
  if (existingPair) {
    setTarget(work, existingPair, "endpoints", recordsOf(engine, work.sheet).get(existingPair));
    return "resolved";
  }
  if (work.op === "skip") return "settled";

  // An end that is still waiting for a decision blocks this row instead of failing it.
  const pending = work.edges.some((edge) => !edge.target.identity.targetPublicId && edge.target.classification !== "create");
  if (pending) {
    work.classification = "update";
    work.operation = work.op === "reset_to_central" ? "reset_to_central" : work.op === "remove_link" ? "remove_link" : "update";
    return "settled";
  }
  work.classification = "invalid";
  addDiagnostic(work, {
    severity: "error",
    code: work.op === "reset_to_central" ? "reset_without_override" : "update_requires_id",
    column: idColumn,
  });
  return "settled";
}

/* ------------------------------------------------------------------ */
/* Diff against the current record                                     */
/* ------------------------------------------------------------------ */

function diffColumns(work: WorkRow) {
  const link = Boolean(LINK_ENDPOINTS[work.sheet]);
  return work.def.columns.filter(
    (column) =>
      !MECHANICS.has(column.key) &&
      !column.isKey &&
      !column.readonly &&
      !isDeferredColumn(work.sheet, column.key) &&
      !(link && column.type === "reference") &&
      fromSource(work, column.key),
  );
}

function proposedValue(work: WorkRow, column: string, type: string) {
  const value = work.typed[column];
  if (value === undefined) return undefined;
  return type === "reference" ? (work.endpoints[column] ?? value) : value;
}

function cellOf(work: WorkRow, column: string) {
  return work.input.source?.cells[column];
}

function buildCreate(work: WorkRow) {
  const after: Row = {};
  for (const column of work.def.columns) {
    if (MECHANICS.has(column.key) || column.readonly || isDeferredColumn(work.sheet, column.key)) continue;
    const value = column.isKey ? work.key : proposedValue(work, column.key, column.type);
    if (value !== undefined && value !== "") after[column.key] = value;
  }
  work.after = after;
  work.changes = Object.entries(after)
    .filter(([column]) => column !== work.def.columns[0]!.key)
    .map(([column, value]) => ({ column, before: null, after: value, ...(cellOf(work, column) ? { cell: cellOf(work, column) } : {}) }));
}

function statusColumn(sheet: string) {
  if (ACTIVE_FLAG_SHEETS.has(sheet)) return "active";
  return ARCHIVE_FLAG_SHEETS.has(sheet) ? "archived" : "status";
}

function archivedValue(sheet: string) {
  if (ACTIVE_FLAG_SHEETS.has(sheet)) return "FALSE";
  return ARCHIVE_FLAG_SHEETS.has(sheet) ? "TRUE" : "archived";
}

function isArchivedValue(sheet: string, value: string | undefined) {
  return value === archivedValue(sheet);
}

/** A Units name that only names a standard unit ("g", "Gram") identifies it; it is not a rename of that unit (D11). */
function keepStandardName(work: WorkRow, before: Row) {
  if (work.sheet !== "Units" || !before.standard_code || work.typed.name === undefined) return;
  const standard = standardUnitOfRow({ name: work.typed.name });
  if (standard?.code === before.standard_code && !work.typed.standard_code) work.typed.name = before.name ?? work.typed.name;
}

function buildUpdate(engine: Engine, work: WorkRow, decision: RowDecision | undefined) {
  const before = work.before ?? {};
  keepStandardName(work, before);
  const after: Row = { ...before };
  for (const column of diffColumns(work)) {
    const value = proposedValue(work, column.key, column.type);
    if (value !== undefined) after[column.key] = value;
  }
  for (const column of work.clears) after[column] = "";

  const status = statusColumn(work.sheet);
  if (work.op === "archive" && work.def.columns.some((column) => column.key === status)) {
    after[status] = archivedValue(work.sheet);
  }
  if (work.op === "reset_to_central") {
    after.amount_minor = "";
  }
  work.after = after;

  const columns = new Set([...diffColumns(work).map((column) => column.key), ...work.clears, status, ...(work.op === "reset_to_central" ? ["amount_minor"] : [])]);
  work.changes = [...columns]
    .filter((column) => (after[column] ?? "") !== (before[column] ?? ""))
    .map((column) => ({
      column,
      before: before[column] ? before[column]! : null,
      after: after[column] ? after[column]! : null,
      ...(cellOf(work, column) ? { cell: cellOf(work, column) } : {}),
    }));

  // Revision: a mismatch is a conflict; a blank token is bound now and re-checked by QOS-217.
  const current = before.expected_revision ?? "";
  // D4: a token of the approved record a draft was saved from is current while that record is unchanged.
  const frozen = work.frozenSource ? recordsOf(engine, work.sheet).get(work.frozenSource) : undefined;
  const given = frozen && work.typed.expected_revision === frozen.expected_revision ? current : work.typed.expected_revision;
  work.identity.targetRevision = current || null;
  if (given && given !== current) {
    if (decision?.kind === "accept_current_revision") {
      work.decision = decision;
    } else {
      conflict(work, "stale_revision", undefined, { expected: given, current });
      return;
    }
  } else if (decision?.kind === "accept_current_revision") {
    rejectDecision(work, decision, "revision_current");
  }
  if (!given && work.op !== "skip") {
    addDiagnostic(work, { severity: "info", code: "revision_bound_at_review", params: { revision: current } });
  }

  if (work.sheet === "Branch Prices" && work.typed.central_price_version && work.typed.central_price_version !== before.central_price_version) {
    addDiagnostic(work, {
      severity: "info",
      code: "value_normalized",
      column: "central_price_version",
      params: { value: work.typed.central_price_version, normalized: before.central_price_version ?? "" },
    });
  }

  if (work.op === "remove_link") {
    work.classification = "update";
    work.operation = "remove_link";
    work.changes = [];
    return;
  }
  if (work.op === "reset_to_central") {
    work.classification = "update";
    work.operation = "reset_to_central";
    return;
  }
  if (work.op === "archive" && ARCHIVE_OPERATION_SHEETS.has(work.sheet)) {
    // No status column: discarding a draft or leaving a line, step or effect out of the draft (QOS-200).
    work.classification = "update";
    work.operation = "archive";
    work.changes = [];
    return;
  }
  if (work.changes.length === 0) {
    work.classification = "unchanged";
    work.operation = null;
    return;
  }
  work.classification = "update";
  const wasArchived = isArchivedValue(work.sheet, before[status]);
  const willArchive = isArchivedValue(work.sheet, after[status]);
  if (willArchive && !wasArchived) {
    work.operation = "archive";
  } else if (wasArchived && !willArchive && work.def.columns.some((column) => column.key === status)) {
    work.operation = "restore";
  } else {
    work.operation = "update";
  }
  if (status === "status" && after.status === "active" && before.status !== "active") {
    addDiagnostic(work, { severity: "info", code: "status_not_approval", column: "status" });
  }
  if (work.sheet === "Variants" && work.operation === "archive" && before.is_default === "TRUE") {
    work.classification = "invalid";
    addDiagnostic(work, { severity: "error", code: "default_variant_archive", column: "status", params: { id: work.identity.targetPublicId ?? "" } });
  }
}

/* ------------------------------------------------------------------ */
/* Per-row classification                                              */
/* ------------------------------------------------------------------ */

function reviewUnsupported(engine: Engine, work: WorkRow, keys: ReturnType<typeof buildKeyIndex>) {
  typeRow(work, engine.snapshot);
  resolveReferences(work, keys, engine.snapshot, engine.input.keysVerified);
  checkConditionalInputs(work);
  work.classification = "unsupported";
  addDiagnostic(work, {
    severity: "info",
    code: "action_unsupported",
    params: { reason: isUnsupportedSheet(work.sheet) ? "unsupported_sheet" : "unsupported_action", owner: sheetOwner(work.sheet) },
  });
}

/* Conditional inputs on the Phase 2 sheets (QOS-200): a missing recipe target
   or effect input is an error on create. Ingredient cost context stays a
   warning, because the service supplies the tenant currency and today. */
const PHASE2_CONDITIONAL: Record<string, "error" | "warning" | undefined> = {
  Recipes: "error",
  "Modifier Effects": "error",
  Ingredients: "warning",
};

function reviewSupported(engine: Engine, work: WorkRow, keys: ReturnType<typeof buildKeyIndex>) {
  const resolution = resolveAction(work.sheet as (typeof SUPPORTED_ENTITY_SHEETS)[number], work.requestedAction);
  if (resolution.kind === "invalid") {
    addDiagnostic(work, { severity: "error", code: resolution.code, column: "action", params: { value: resolution.value, allowed: resolution.allowed } });
  } else if (resolution.kind === "unsupported") {
    work.op = null;
  } else {
    work.op = resolution.operation;
    if (resolution.normalized) {
      addDiagnostic(work, { severity: "info", code: "value_normalized", column: "action", params: { value: work.requestedAction, normalized: resolution.action } });
    }
  }
  typeRow(work, engine.snapshot);
  resolveReferences(work, keys, engine.snapshot, engine.input.keysVerified);
  if (work.sheet === "Recipes" && work.typed.recipe_key) {
    // recipe_key names a family: a key QOS linked earlier compares as that family's id, as the export writes it.
    work.typed.recipe_key = engine.snapshot.typedLinks.get(RECIPE_FAMILY_LINKS)?.get(work.typed.recipe_key) ?? work.typed.recipe_key;
  }
  if (PHASE2_CONDITIONAL[work.sheet] && work.op === "create") {
    checkConditionalInputs(work, PHASE2_CONDITIONAL[work.sheet]);
  }
  work.deferredFields = deferredFieldsOf(work);
  if (work.deferredFields.length > 0) {
    addDiagnostic(work, { severity: "info", code: "deferred_value", params: { count: work.deferredFields.length } });
  }

  if (resolution.kind === "unsupported") {
    work.classification = "unsupported";
    addDiagnostic(work, { severity: "info", code: "action_unsupported", column: "action", params: { reason: "unsupported_action", owner: resolution.owner, value: resolution.action } });
    return;
  }
  if (resolution.kind === "invalid") {
    work.classification = "invalid";
    return;
  }

  const decision = engine.decisions.get(decisionId(work.sheet, work.input.row));
  if (decision?.kind === "exclude") {
    work.decision = decision;
    work.excluded = true;
    const id = namedId(engine, work);
    const record = id ? recordsOf(engine, work.sheet)?.get(id) : undefined;
    if (record) setTarget(work, id, "qos_id", record);
    work.classification = "skipped";
    return;
  }

  const outcome = LINK_ENDPOINTS[work.sheet] ? resolveLinkTarget(engine, work) : resolveEntityTarget(engine, work, decision);

  if (outcome === "resolved") {
    if (work.op === "skip") {
      work.classification = "skipped";
      work.operation = null;
    } else {
      buildUpdate(engine, work, decision);
    }
  } else if (work.op === "skip" && work.classification === null) {
    work.classification = "skipped";
  } else if (work.classification === "create") {
    buildCreate(work);
  } else if (work.classification === "conflicting" || work.classification === "update") {
    // Show what the row would set, for the operator deciding.
    buildCreateView(work);
  }

  if (hasErrors(work) && work.classification !== "conflicting") {
    work.classification = "invalid";
    work.operation = null;
  }
}

/** Proposed values of a row that has no target yet, for display only. */
function buildCreateView(work: WorkRow) {
  const after: Row = {};
  for (const column of work.def.columns) {
    if (MECHANICS.has(column.key) || column.readonly || isDeferredColumn(work.sheet, column.key)) continue;
    const value = column.isKey ? work.key : proposedValue(work, column.key, column.type);
    if (value) after[column.key] = value;
  }
  work.after = after;
}

/* ------------------------------------------------------------------ */
/* Sheet-level rules                                                   */
/* ------------------------------------------------------------------ */

function markDuplicates(works: WorkRow[]) {
  const byKey = new Map<string, WorkRow[]>();
  for (const work of works) {
    if (!work.key) continue;
    const id = `${work.sheet}\u0000${work.key}`;
    byKey.set(id, [...(byKey.get(id) ?? []), work]);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const work of group) {
      addDiagnostic(work, {
        severity: work.supported ? "error" : "warning",
        code: "duplicate_key",
        params: { key: work.key, rows: group.map((other) => other.input.row).join(", ") },
      });
      if (work.supported && work.classification !== "unsupported") {
        work.classification = "invalid";
        work.operation = null;
      }
    }
  }

  // Two creates in one scope with the same loose name: neither may be created silently.
  const creates = works.filter((work) => work.supported && work.classification === "create" && !work.acknowledgedCollision && ENTITY_SHEETS.has(work.sheet));
  for (let index = 0; index < creates.length; index += 1) {
    const left = creates[index]!;
    for (const right of creates.slice(index + 1)) {
      if (left.sheet !== right.sheet) continue;
      const parent = PARENT_COLUMN[left.sheet];
      if (parent && (left.input.values[parent] ?? "") !== (right.input.values[parent] ?? "")) continue;
      if (looseNames(left.sheet, left.input.values).size === 0 || !namesCollide(left.sheet, left.input.values, right.input.values)) continue;
      for (const [work, other] of [
        [left, right],
        [right, left],
      ] as const) {
        if (work.classification !== "conflicting") {
          work.classification = "conflicting";
          work.operation = null;
        }
        addDiagnostic(work, { severity: "error", code: "duplicate_name_in_workbook", params: { row: other.input.row, key: other.key } });
      }
    }
  }
}

function productGroupKey(work: WorkRow) {
  const endpoint = work.endpoints.product_key;
  if (endpoint) return `id:${endpoint}`;
  const edge = work.edges.find((entry) => entry.column === "product_key");
  return edge ? `row:${edge.target.sheet}:${edge.target.input.row}` : null;
}

function effectiveFlag(work: WorkRow, column: string) {
  return work.after?.[column] ?? work.before?.[column] ?? work.typed[column] ?? "";
}

/** Exactly one default variant per product, counting the workbook rows and the existing variants they leave alone. */
function enforceDefaultVariants(engine: Engine) {
  const groups = new Map<string, { productId: string | null; rows: WorkRow[] }>();
  for (const work of engine.works) {
    if (work.sheet !== "Variants" || !work.supported) continue;
    const counted = (work.classification && PROPOSING.has(work.classification)) || (work.classification === "skipped" && work.identity.targetPublicId);
    if (!counted) continue;
    const key = productGroupKey(work);
    if (!key) continue;
    const group = groups.get(key) ?? { productId: work.endpoints.product_key ?? null, rows: [] };
    group.rows.push(work);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const targeted = new Set(group.rows.map((work) => work.identity.targetPublicId).filter(Boolean));
    const existing = group.productId ? variantsOfProduct(engine.snapshot, group.productId) : [];
    let defaults = existing.filter(([publicId, row]) => !targeted.has(publicId) && row.status !== "archived" && row.is_default === "TRUE").length;
    defaults += group.rows.filter((work) => effectiveFlag(work, "status") !== "archived" && effectiveFlag(work, "is_default") === "TRUE").length;
    if (defaults === 1) continue;
    for (const work of group.rows) {
      if (!work.classification || !PROPOSING.has(work.classification)) continue;
      conflict(
        work,
        "default_variant_conflict",
        existing.map(([publicId]) => candidateOf(engine.snapshot, "Variants", publicId, "variant_target")),
        { count: defaults },
      );
      work.operation = null;
    }
  }

  // A new product needs its default variant in the workbook: QOS creates a product with its default price.
  for (const work of engine.works) {
    if (work.sheet !== "Products" || work.classification !== "create") continue;
    const hasVariant = engine.works.some(
      (variant) => variant.sheet === "Variants" && variant.edges.some((edge) => edge.column === "product_key" && edge.target === work),
    );
    if (!hasVariant) {
      work.classification = "invalid";
      work.operation = null;
      addDiagnostic(work, { severity: "error", code: "default_variant_conflict", params: { count: 0 } });
    }
  }
}

/** Default options may not exceed the group's maximum selections. */
function enforceOptionDefaults(engine: Engine) {
  const groups = new Map<string, { groupId: string | null; groupRow: WorkRow | null; rows: WorkRow[] }>();
  for (const work of engine.works) {
    if (work.sheet !== "Modifier Options" || !work.supported) continue;
    const counted = (work.classification && PROPOSING.has(work.classification)) || (work.classification === "skipped" && work.identity.targetPublicId);
    if (!counted) continue;
    const edge = work.edges.find((entry) => entry.column === "modifier_group_key");
    const groupId = work.endpoints.modifier_group_key ?? null;
    const key = groupId ? `id:${groupId}` : edge ? `row:${edge.target.input.row}` : null;
    if (!key) continue;
    const group = groups.get(key) ?? { groupId, groupRow: edge?.target ?? null, rows: [] };
    group.rows.push(work);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const groupRecord = group.groupId ? engine.snapshot.records["Modifier Groups"].get(group.groupId) : undefined;
    const max = Number(group.groupRow?.after?.max_selections ?? group.groupRow?.typed.max_selections ?? groupRecord?.max_selections ?? "");
    if (!Number.isFinite(max)) continue;
    const targeted = new Set(group.rows.map((work) => work.identity.targetPublicId).filter(Boolean));
    const existing = group.groupId ? recordsInScope(engine.snapshot, "Modifier Options", group.groupId) : [];
    const defaults =
      existing.filter(([publicId, row]) => !targeted.has(publicId) && row.status !== "archived" && row.is_default === "TRUE").length +
      group.rows.filter((work) => effectiveFlag(work, "is_default") === "TRUE").length;
    if (defaults <= max) continue;
    for (const work of group.rows) {
      if (!work.classification || !PROPOSING.has(work.classification) || effectiveFlag(work, "is_default") !== "TRUE") continue;
      conflict(work, "too_many_defaults", undefined, { count: defaults, max });
      work.operation = null;
    }
  }
}

function runServiceChecks(engine: Engine) {
  for (const work of engine.works) {
    if (!work.supported || hasErrors(work)) continue;
    if (work.classification !== "create" && work.classification !== "update") continue;
    dropImportStatus(work);
    // Link removals and central-price resets are updates with no field changes.
    if (work.classification === "update" && work.operation === "update" && work.changes.length === 0) {
      work.classification = "unchanged";
      work.operation = null;
      continue;
    }
    const parity = checkApplyParity(work, engine.service);
    if (parity) {
      addDiagnostic(work, parity);
      work.classification = "invalid";
      work.operation = null;
      continue;
    }
    if (work.operation === "remove_link" || work.operation === "reset_to_central") continue;
    const values: Row =
      work.classification === "create"
        ? (work.after ?? {})
        : Object.fromEntries(work.changes.map((change) => [change.column, change.after ?? ""]));
    const diagnostic = checkService(work, values, engine.service);
    if (diagnostic) {
      addDiagnostic(work, diagnostic);
      work.classification = "invalid";
      work.operation = null;
    }
  }
}

function serviceContext(snapshot: ReviewSnapshot, works: WorkRow[]): ServiceContext {
  return {
    snapshot,
    defaultVariantAmount(productKey) {
      const variant = works.find(
        (work) => work.sheet === "Variants" && work.typed.product_key === productKey && work.typed.is_default === "TRUE" && work.typed.amount_minor !== undefined,
      );
      return variant ? Number(variant.typed.amount_minor) : null;
    },
    menuLocations(menuKey) {
      return works
        .filter((work) => work.sheet === "Menu Branches" && work.typed.menu_key === menuKey && work.endpoints.branch_key)
        .map((work) => work.endpoints.branch_key!);
    },
    variantCount(product) {
      const existing = recordsInScope(snapshot, "Variants", product).filter(([, row]) => row.status !== "archived");
      const archivedHere = works.filter(
        (work) => work.sheet === "Variants" && work.identity.targetPublicId && work.after?.status === "archived" && existing.some(([id]) => id === work.identity.targetPublicId),
      ).length;
      const creates = works.filter(
        (work) => work.sheet === "Variants" && work.op === "create" && !work.identity.targetPublicId && (work.endpoints.product_key ?? work.typed.product_key) === product,
      ).length;
      return existing.length - archivedHere + creates;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

function linkLabel(engine: Engine, work: WorkRow) {
  const parts = (LINK_ENDPOINTS[work.sheet] ?? []).map((column) => {
    const edge = work.edges.find((entry) => entry.column === column);
    if (edge) return rowLabel(engine, edge.target);
    const endpoint = work.endpoints[column];
    const refSheet = work.def.columns.find((entry) => entry.key === column)?.ref?.sheet ?? "";
    if (endpoint) return recordLabel(engine.snapshot, refSheet, endpoint);
    const key = work.input.values[column] ?? "";
    return { en: key, ar: key };
  });
  return {
    en: parts.map((part) => part.en).filter(Boolean).join(" · "),
    ar: parts.map((part) => part.ar).filter(Boolean).join(" · "),
  };
}

/** Label of the record a reference column names: the workbook row's own label or the existing record's. */
function referenceLabel(engine: Engine, work: WorkRow, column: string, sheet: string) {
  const edge = work.edges.find((entry) => entry.column === column);
  if (edge) return rowLabel(engine, edge.target);
  const target = referenced(work, column, engine.snapshot);
  if (target.publicId) return recordLabel(engine.snapshot, sheet, target.publicId);
  const key = work.input.values[column] ?? "";
  return { en: key, ar: key };
}

function rowLabel(engine: Engine, work: WorkRow): { en: string; ar: string } {
  if (LINK_ENDPOINTS[work.sheet]) return linkLabel(engine, work);
  if (work.sheet === "Recipe Lines" || work.sheet === "Modifier Effects") {
    const named =
      work.sheet === "Recipe Lines"
        ? referenceLabel(engine, work, "ingredient_key", "Ingredients")
        : referenceLabel(engine, work, "modifier_option_key", "Modifier Options");
    const detail = work.sheet === "Recipe Lines" ? (work.input.values.quantity_recipe_units ?? "") : (work.input.values.effect_type ?? "");
    return {
      en: [named.en, detail].filter(Boolean).join(" · "),
      ar: [named.ar, detail].filter(Boolean).join(" · "),
    };
  }
  const own = labelOf(work.sheet, work.input.values);
  if (own.en || own.ar) {
    if (work.sheet === "Variants") {
      const productEdge = work.edges.find((edge) => edge.column === "product_key");
      const product = productEdge
        ? labelOf("Products", productEdge.target.input.values)
        : work.endpoints.product_key
          ? recordLabel(engine.snapshot, "Products", work.endpoints.product_key)
          : { en: "", ar: "" };
      return {
        en: [product.en, own.en].filter(Boolean).join(" · "),
        ar: [product.ar, own.ar].filter(Boolean).join(" · "),
      };
    }
    return own;
  }
  if (work.identity.targetPublicId) return recordLabel(engine.snapshot, work.sheet, work.identity.targetPublicId);
  if (work.sheet === "Variants") {
    const productEdge = work.edges.find((edge) => edge.column === "product_key");
    if (productEdge) return labelOf("Products", productEdge.target.input.values);
  }
  return { en: work.key, ar: work.key };
}

function emptyCounts(): Record<ReviewClassification, number> {
  return Object.fromEntries(REVIEW_CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<ReviewClassification, number>;
}

function toRow(engine: Engine, work: WorkRow): ReviewRow {
  return {
    sheet: work.sheet,
    row: work.input.row,
    key: work.key,
    requestedAction: work.requestedAction,
    classification: work.classification ?? "invalid",
    operation: work.classification === "create" || work.classification === "update" ? work.operation : null,
    identity: work.identity,
    label: rowLabel(engine, work),
    before: work.before,
    after: work.after,
    changes: work.changes,
    deferredFields: work.deferredFields,
    diagnostics: work.diagnostics,
    dependencies: { blockedBy: work.blockedBy, blocks: work.blocks },
    ...(work.branch ? { branch: work.branch } : {}),
    ...(work.candidates && work.candidates.length > 0 ? { candidates: work.candidates } : {}),
    ...(work.acknowledgedCollision ? { acknowledgedCollision: true } : {}),
    decision: work.decision,
    ...(work.input.source ? { source: work.input.source } : {}),
  };
}

export function requiredAcknowledgements(rows: ReviewRow[]): RequiredAcknowledgement[] {
  const deferred = new Map<string, RequiredAcknowledgement>();
  for (const row of rows) {
    for (const field of row.deferredFields) {
      const id = `${row.sheet}\u0000${field.column}`;
      const entry = deferred.get(id) ?? { kind: "acknowledge_deferred", sheet: row.sheet, column: field.column, rows: 0 };
      entry.rows += 1;
      deferred.set(id, entry);
    }
  }
  const required: RequiredAcknowledgement[] = [...deferred.values()];
  const warned = rows.filter((row) => row.classification !== "unsupported" && row.diagnostics.some((diagnostic) => diagnostic.severity === "warning")).length;
  if (warned > 0) required.push({ kind: "acknowledge_warnings", rows: warned });
  const partial = rows.filter((row) => ["invalid", "conflicting", "blocked", "unsupported"].includes(row.classification) || row.decision?.kind === "exclude").length;
  if (partial > 0) required.push({ kind: "acknowledge_partial_apply", rows: partial });
  return required;
}

export function acknowledgementMatches(required: RequiredAcknowledgement, given: PlanAcknowledgement) {
  if (required.kind !== given.kind) return false;
  if (given.kind === "acknowledge_deferred") return given.sheet === required.sheet && given.column === required.column;
  return true;
}

/** Counts, acknowledgements and readiness from the rows; also used when a stored plan is loaded. */
export function summarizeRows(rows: ReviewRow[], acknowledgements: PlanAcknowledgement[], stale = false) {
  const counts: ReviewCounts = { ...emptyCounts(), rows: rows.length, deferredValues: 0, acknowledgementsPending: 0 };
  for (const row of rows) {
    counts[row.classification] += 1;
    counts.deferredValues += row.deferredFields.length;
  }
  const required = requiredAcknowledgements(rows);
  const given = acknowledgements.filter((entry) => required.some((need) => acknowledgementMatches(need, entry)));
  counts.acknowledgementsPending = required.filter((need) => !given.some((entry) => acknowledgementMatches(need, entry))).length;
  const blockers: WorkbookReview["readiness"]["blockers"] = [];
  if (counts.conflicting > 0) blockers.push("conflicting");
  if (counts.invalid > 0) blockers.push("invalid");
  if (counts.acknowledgementsPending > 0) blockers.push("acknowledgements");
  if (stale) blockers.push("stale");
  return { counts, required, given, readiness: { reviewComplete: blockers.length === 0, blockers } };
}

/** The context a review reports: the input's, minus its rows, with the snapshot's branch scope. */
export function reviewContext(input: ReviewInput | ReviewInputMeta, snapshot: Pick<ReviewSnapshot, "branchScope">): ReviewContext {
  return {
    profile: input.profile,
    sourceProfile: input.sourceProfile,
    fileName: input.fileName,
    fileFingerprint: input.fileFingerprint,
    ...(input.sourceFileSha256 ? { sourceFileSha256: input.sourceFileSha256 } : {}),
    templateVersion: input.templateVersion,
    dictionaryVersion: input.dictionaryVersion,
    tenantPublicId: input.tenantPublicId,
    brandPublicId: input.brandPublicId,
    currency: input.currency,
    sourceNamespace: input.sourceNamespace,
    keysVerified: input.keysVerified,
    isExport: input.isExport,
    ...(input.exportRevision ? { exportRevision: input.exportRevision } : {}),
    branchScope: snapshot.branchScope,
    ...(input.requiredMappings ? { requiredMappings: input.requiredMappings } : {}),
    ...(input.ignoredSheets ? { ignoredSheets: input.ignoredSheets } : {}),
  };
}

function dedupeAcknowledgements(decisions: PlanDecision[]) {
  const seen = new Set<string>();
  return decisions.filter(isAcknowledgement).filter((entry) => {
    const id = JSON.stringify(entry.kind === "acknowledge_deferred" ? [entry.kind, entry.sheet, entry.column] : [entry.kind]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Reviews one normalised upload against a snapshot of the tenant's records,
 * with the operator's decisions. Pure: the same input, snapshot and
 * decisions always give the same result.
 */
export function reviewWorkbook(input: ReviewInput, snapshot: ReviewSnapshot, decisions: PlanDecision[] = []): WorkbookReview {
  const works = input.sheets
    .filter((sheet) => SHEET_ORDER.has(sheet.sheet) && sheet.support !== "separate_profile")
    .sort((a, b) => SHEET_ORDER.get(a.sheet)! - SHEET_ORDER.get(b.sheet)!)
    .flatMap((sheet) => sheet.rows.map((row) => newWork(sheet.sheet, row, input.sourceNamespace, input.keysVerified)));
  attachParseIssues(works, input.parseIssues, input.profile === "foodics_menu_v1");

  const engine: Engine = {
    input,
    snapshot,
    works,
    decisions: indexDecisions(works, decisions),
    pairs: linkPairIndex(snapshot),
    service: serviceContext(snapshot, works),
  };
  const keys = buildKeyIndex(works);

  for (const work of works) {
    if (work.supported) reviewSupported(engine, work, keys);
    else reviewUnsupported(engine, work, keys);
  }
  markDuplicates(works);
  enforceDefaultVariants(engine);
  enforceOptionDefaults(engine);
  runServiceChecks(engine);
  enforcePhase2({ works, snapshot, keysVerified: input.keysVerified });
  propagateBlocking(works);

  const rows = works.map((work) => toRow(engine, work));
  const given = dedupeAcknowledgements(decisions);
  const summary = summarizeRows(rows, given);

  const notices: ReviewDiagnostic[] = [];
  if (input.exportRevision && snapshot.exportRevision && input.exportRevision !== snapshot.exportRevision) {
    notices.push({ severity: "info", code: "export_outdated", params: { exported: input.exportRevision, current: snapshot.exportRevision } });
  }

  const sheets = input.sheets
    .filter((sheet) => sheet.rows.length > 0 || sheet.issues.length > 0)
    .map((sheet) => {
      const counts = emptyCounts();
      for (const row of rows) if (row.sheet === sheet.sheet) counts[row.classification] += 1;
      return { sheet: sheet.sheet, support: sheet.support, present: sheet.present, rowCount: sheet.rows.length, counts, issues: sheet.issues };
    });

  return {
    context: reviewContext(input, snapshot),
    counts: summary.counts,
    sheets,
    fieldDecisions: computeFieldDecisions(input),
    parseIssues: input.parseIssues,
    notices,
    rows,
    acknowledgements: { required: summary.required, given: summary.given },
    readiness: summary.readiness,
  };
}
