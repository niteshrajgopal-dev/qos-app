import type { DbClient } from "@/db/client";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import type { DbTransaction } from "@/lib/tenant/context";
import type { SupportedEntitySheet } from "@/lib/workbook/contract";
import type { ApplyActor } from "@/lib/workbook/apply/audit";
import type { ApplyImageOutcome } from "@/lib/workbook/apply/model";
import type { ApplyRecord } from "@/lib/workbook/apply/repository";
import type { TokenScope } from "@/lib/workbook/apply/revisions";
import type { PlanRecord, PlanRowRecord } from "@/lib/workbook/validation/plan-repository";
import type { ReviewSnapshot } from "@/lib/workbook/validation/snapshot";

/* Types shared by the apply engine and its sheet handlers (QOS-217). */

/** Downloads and attaches a product image after its unit committed. */
export type ImageIngester = (input: {
  db: DbClient;
  tenantId: string;
  membership: ActiveStaffMembership;
  productPublicId: string;
  url: string;
  subject: string;
}) => Promise<ApplyImageOutcome["status"]>;

/** Test seams: fault injection and the image ingester. The route passes none. */
export type ApplyHooks = {
  /** Called inside a unit after its service calls and links, before audit and checkpoint; throwing rolls the unit back. */
  beforeCheckpoint?: (unit: { sheet: string; rows: number[] }) => void | Promise<void>;
  ingestImage?: ImageIngester;
};

/** Everything one attempt knows while it runs. */
export type ApplyRuntime = {
  db: DbClient;
  tenantId: string;
  membership: ActiveStaffMembership;
  actor: ApplyActor;
  plan: PlanRecord;
  apply: ApplyRecord;
  namespace: string;
  brandPublicId: string;
  /** The fresh snapshot in the plan's branch scope, verified against the plan hash. */
  snapshot: ReviewSnapshot;
  /** Plan rows by sheet and workbook key. */
  rowsByKey: Map<string, Map<string, PlanRowRecord>>;
  /** Public ids saved per plan row id, by this attempt or an earlier one. */
  saved: Map<string, string>;
  /** Revision tokens as the snapshot recorded them, by `sheet\u0000identity`. */
  baseline: Map<string, string>;
  /** Revision tokens this attempt's own committed units left behind. */
  selfWritten: Map<string, string>;
  hooks: ApplyHooks;
};

export type Unit = {
  sheet: SupportedEntitySheet;
  /** The primary row first, then rows saved in the same transaction (default variant, menu branches). */
  rows: PlanRowRecord[];
};

/** Revision guard of one unit: checks targets before the mutation and remembers the scope. */
export type UnitGuard = {
  enter: (scope: TokenScope, targets: PlanRowRecord[]) => Promise<void>;
};

export type SavedRow = {
  row: PlanRowRecord;
  /** The public id (or link id) the row saved. */
  publicId: string;
  fieldsApplied: string[];
  /** Set on creates of entity sheets: the record a typed source link points at. */
  created?: boolean;
  /** A product whose image should be fetched after commit. */
  imageUrl?: string;
};

export type HandlerContext = {
  tx: DbTransaction;
  /** The unit's transaction as a service executor: service transactions nest as savepoints (D-TX). */
  db: DbClient;
  run: ApplyRuntime;
  guard: UnitGuard;
};

export type SheetHandler = (context: HandlerContext, unit: Unit) => Promise<SavedRow[]>;
