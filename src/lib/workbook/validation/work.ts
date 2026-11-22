import type { WorkbookSheetDefinition } from "@/lib/workbook/contract";
import type { WorkbookRow } from "@/lib/workbook/reader";
import type {
  ReviewCandidate,
  ReviewChange,
  ReviewClassification,
  ReviewDeferredField,
  ReviewDiagnostic,
  ReviewIdentity,
  ReviewOperation,
  RowDecision,
  RowRef,
} from "@/lib/workbook/validation/model";

/* Mutable per-row state while one review runs. Internal to the engine; the
   result exposes ReviewRow. */

export type WorkRow = {
  sheet: string;
  def: WorkbookSheetDefinition;
  input: WorkbookRow;
  key: string;
  /** A supported entity sheet (the others are unsupported as a whole). */
  supported: boolean;
  requestedAction: string;
  /** The service operation the action asks for; `skip` does nothing; null when the action is invalid or unsupported. */
  op: ReviewOperation | "skip" | null;
  /** Canonical non-blank values that typed correctly. */
  typed: Record<string, string>;
  clears: string[];
  diagnostics: ReviewDiagnostic[];
  classification: ReviewClassification | null;
  operation: ReviewOperation | null;
  identity: ReviewIdentity;
  before: Record<string, string> | null;
  after: Record<string, string> | null;
  changes: ReviewChange[];
  deferredFields: ReviewDeferredField[];
  candidates?: ReviewCandidate[];
  decision: RowDecision | null;
  acknowledgedCollision?: boolean;
  branch?: { publicId: string; name: string };
  /** References to rows of this workbook. */
  edges: Array<{ column: string; target: WorkRow }>;
  /** Reference column → existing public id it points at, or null when the referenced row is new or unresolved. */
  endpoints: Record<string, string | null>;
  blockedBy: RowRef[];
  blocks: RowRef[];
  excluded: boolean;
};

export function refOf(work: WorkRow): RowRef {
  return { sheet: work.sheet, row: work.input.row, key: work.key };
}

export function hasErrors(work: WorkRow) {
  return work.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function addDiagnostic(work: WorkRow, diagnostic: ReviewDiagnostic) {
  const cell = diagnostic.cell ?? (diagnostic.column ? work.input.source?.cells[diagnostic.column] : undefined);
  work.diagnostics.push(cell ? { ...diagnostic, cell } : diagnostic);
}

/** Whether a converted row's column came from a source cell (as opposed to a conversion default). */
export function fromSource(work: WorkRow, column: string) {
  return !work.input.source || column in work.input.source.cells;
}
