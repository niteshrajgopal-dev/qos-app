import { and, eq, isNull, max } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryItemConversionRecord,
  type InventoryItemRecord,
  inventoryItemConversions,
} from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import {
  assertRuleInsertable,
  buildItemGraph,
  classifyPair,
  type GraphUnit,
  validateConversionInput,
  validateFactorAndJustification,
} from "@/lib/inventory/conversion-graph";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import { type ItemDetailView, loadItemByPublicIdInTx, loadItemDetailInTx } from "@/lib/inventory/items";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import {
  asBody,
  loadTenantUnitsInTx,
  loadUnitByPublicIdInTx,
  parseExpectedVersion,
  parseOptionalDate,
  requireInventoryAdministrator,
  shortRandomHex,
  tenantToday,
  uniqueViolationConstraint,
} from "@/lib/inventory/shared";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-195 item-scoped conversions. A row means 1 from unit = factor to unit
   for one item. Rows are append-only versions (as catalogue reference-cost
   policies): a revision closes the current row with effective_to and
   inserts the next revision, and qos_app can update no column other than
   effective_to, so a stored factor is never rewritten.

   Nothing in this repository posts stock movements yet. When QOS-201/202
   post a receipt, count or consumption they must store the conversion row
   id used (the version row, not the pair) plus a snapshot of from code, to
   code, factor_micros and effective_from on the movement. Because version
   rows are immutable apart from effective_to, a posted quantity always
   traces back to the exact factor used, and a later revision cannot
   reinterpret it. */

type ConversionMutation = {
  db: DbClient;
  tenantId: string;
  membership: ActiveStaffMembership;
  actorSubject: string;
  itemPublicId: string;
  now?: Date;
};

function generateConversionPublicId() {
  return `conv_${shortRandomHex(20)}`;
}

function graphUnit(unit: GraphUnit): GraphUnit {
  return {
    id: unit.id,
    code: unit.code,
    quantityKind: unit.quantityKind,
    standardCode: unit.standardCode,
    status: unit.status,
  };
}

function auditConversion(row: InventoryItemConversionRecord | null, codes: Map<string, string>) {
  if (!row) {
    return null;
  }
  return {
    conversionPublicId: row.publicId,
    fromUnit: codes.get(row.fromUnitId) ?? row.fromUnitId,
    toUnit: codes.get(row.toUnitId) ?? row.toUnitId,
    factor: microsToDecimalString(row.factorMicros),
    factorMicros: row.factorMicros.toString(),
    justification: row.justification,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    revision: row.revision,
  };
}

async function loadCurrentRulesInTx(tx: DbClient, tenantId: string, itemId: string) {
  return tx
    .select()
    .from(inventoryItemConversions)
    .where(
      and(
        eq(inventoryItemConversions.tenantId, tenantId),
        eq(inventoryItemConversions.itemId, itemId),
        isNull(inventoryItemConversions.effectiveTo),
      ),
    );
}

/** Locks the item so concurrent rule writes for it serialise (the graph check stays valid). */
async function loadWritableItemInTx(tx: DbClient, tenantId: string, itemPublicId: string): Promise<InventoryItemRecord> {
  const item = await loadItemByPublicIdInTx(tx, tenantId, itemPublicId, "update");
  if (item.status !== "active") {
    throw new InventoryConflictError(
      "This item is archived. Restore it before changing its conversions.",
      "item_archived",
      "itemPublicId",
    );
  }
  return item;
}

function mapConversionWriteError(error: unknown): never {
  const constraint = uniqueViolationConstraint(error);
  if (constraint !== null) {
    throw new InventoryConflictError(
      "This conversion changed elsewhere. Reload and try again.",
      "expected_version_mismatch",
      "expectedRevision",
    );
  }
  throw error;
}

async function recordConversionAudit(
  tx: DbClient,
  context: ConversionMutation,
  item: InventoryItemRecord,
  action: string,
  before: InventoryItemConversionRecord | null,
  after: InventoryItemConversionRecord | null,
  revision: number,
) {
  const codes = new Map((await loadTenantUnitsInTx(tx, context.tenantId)).map((unit) => [unit.id, unit.code]));
  await recordTenantAuditEventInTx(tx, {
    tenantId: context.tenantId,
    actorSubject: context.actorSubject,
    actorClass: auditActorClassFromStaffRole(context.membership.role),
    action,
    entityType: "inventory_item_conversion",
    entityPublicId: item.publicId,
    entityVersion: revision,
    changeSummary: {
      conversionPublicId: (after ?? before)!.publicId,
      before: auditConversion(before, codes),
      after: auditConversion(after, codes),
    },
  });
}

export type CreateConversionInput = {
  fromUnitPublicId: string;
  toUnitPublicId: string;
  factor: string;
  justification?: string | null;
  effectiveFrom?: string | null;
};

export async function createConversion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const requestedFrom = parseOptionalDate(body.effectiveFrom);
  const context = { db, tenantId, membership, actorSubject, itemPublicId, now };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const item = await loadWritableItemInTx(tx, tenantId, itemPublicId);
      const from = await loadUnitByPublicIdInTx(tx, tenantId, body.fromUnitPublicId, "fromUnitPublicId");
      const to = await loadUnitByPublicIdInTx(tx, tenantId, body.toUnitPublicId, "toUnitPublicId");
      const validated = validateConversionInput({
        from: graphUnit(from),
        to: graphUnit(to),
        factor: body.factor,
        justification: body.justification,
      });

      const units = await loadTenantUnitsInTx(tx, tenantId);
      const current = await loadCurrentRulesInTx(tx, tenantId, item.id);
      assertRuleInsertable(
        buildItemGraph(
          units.map(graphUnit),
          current.map((rule) => ({
            id: rule.id,
            fromUnitId: rule.fromUnitId,
            toUnitId: rule.toUnitId,
            factorMicros: rule.factorMicros,
          })),
        ),
        from.id,
        to.id,
      );

      const pairFilter = and(
        eq(inventoryItemConversions.tenantId, tenantId),
        eq(inventoryItemConversions.itemId, item.id),
        eq(inventoryItemConversions.fromUnitId, from.id),
        eq(inventoryItemConversions.toUnitId, to.id),
      );
      const [latest] = await tx
        .select({ revision: max(inventoryItemConversions.revision), effectiveTo: max(inventoryItemConversions.effectiveTo) })
        .from(inventoryItemConversions)
        .where(pairFilter);
      const effectiveFrom = requestedFrom ?? (await tenantToday(tx, tenantId, now));
      if (latest?.effectiveTo && effectiveFrom < latest.effectiveTo) {
        throw new InventoryError(
          `The effective date cannot be earlier than ${latest.effectiveTo}, when the previous rule for this pair ended. History is not rewritten.`,
          400,
          "effective_from_before_current",
          "effectiveFrom",
        );
      }

      const [inserted] = await tx
        .insert(inventoryItemConversions)
        .values({
          tenantId,
          publicId: generateConversionPublicId(),
          itemId: item.id,
          fromUnitId: from.id,
          toUnitId: to.id,
          factorMicros: validated.factorMicros,
          justification: validated.justification,
          effectiveFrom,
          effectiveTo: null,
          revision: (latest?.revision ?? 0) + 1,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
        })
        .returning();
      await recordConversionAudit(tx, context, item, "inventory.conversion.create", null, inserted!, inserted!.revision);
      return loadItemDetailInTx(tx, tenantId, item.id);
    });
  } catch (error) {
    return mapConversionWriteError(error);
  }
}

async function loadCurrentConversionInTx(
  tx: DbClient,
  tenantId: string,
  item: InventoryItemRecord,
  conversionPublicId: string,
  expectedRevision: number,
): Promise<InventoryItemConversionRecord> {
  const [row] = await tx
    .select()
    .from(inventoryItemConversions)
    .where(
      and(
        eq(inventoryItemConversions.tenantId, tenantId),
        eq(inventoryItemConversions.itemId, item.id),
        eq(inventoryItemConversions.publicId, conversionPublicId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new InventoryError("Conversion not found.", 404, "conversion_not_found", "conversionPublicId");
  }
  if (row.effectiveTo !== null) {
    throw new InventoryConflictError(
      "This version is no longer current. Reload to see the current rule.",
      "conversion_not_current",
      "conversionPublicId",
    );
  }
  if (row.revision !== expectedRevision) {
    throw new InventoryConflictError(
      "This conversion changed elsewhere. Reload and try again.",
      "expected_version_mismatch",
      "expectedRevision",
    );
  }
  return row;
}

/** Sets effective_to on the current row only; qos_app has no UPDATE grant on any other column. */
async function closeRowInTx(tx: DbClient, rowId: string, effectiveTo: string) {
  const closed = await tx
    .update(inventoryItemConversions)
    .set({ effectiveTo })
    .where(and(eq(inventoryItemConversions.id, rowId), isNull(inventoryItemConversions.effectiveTo)))
    .returning();
  if (closed.length !== 1) {
    throw new InventoryConflictError(
      "This conversion changed elsewhere. Reload and try again.",
      "expected_version_mismatch",
      "expectedRevision",
    );
  }
  return closed[0]!;
}

export type UpdateConversionInput =
  | {
      operation: "revise";
      expectedRevision: number;
      factor: string;
      justification?: string | null;
      effectiveFrom?: string | null;
    }
  | { operation: "close"; expectedRevision: number; effectiveFrom?: string | null };

export async function reviseConversion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  conversionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedRevision = parseExpectedVersion(body.expectedRevision, "expectedRevision");
  const requestedFrom = parseOptionalDate(body.effectiveFrom);
  const context = { db, tenantId, membership, actorSubject, itemPublicId, now };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const item = await loadWritableItemInTx(tx, tenantId, itemPublicId);
      const current = await loadCurrentConversionInTx(tx, tenantId, item, conversionPublicId, expectedRevision);
      const units = new Map((await loadTenantUnitsInTx(tx, tenantId)).map((unit) => [unit.id, unit]));
      // The pair is already an edge of this item's graph: a revision changes
      // the factor, not the topology, so the derivability check is not re-run.
      const validated = validateFactorAndJustification(
        classifyPair(graphUnit(units.get(current.fromUnitId)!), graphUnit(units.get(current.toUnitId)!)),
        { factor: body.factor, justification: body.justification },
      );
      const effectiveFrom = requestedFrom ?? (await tenantToday(tx, tenantId, now));
      if (effectiveFrom < current.effectiveFrom) {
        throw new InventoryError(
          `The effective date cannot be earlier than the current version's date (${current.effectiveFrom}). History is not rewritten.`,
          400,
          "effective_from_before_current",
          "effectiveFrom",
        );
      }
      const closed = await closeRowInTx(tx, current.id, effectiveFrom);
      const [inserted] = await tx
        .insert(inventoryItemConversions)
        .values({
          tenantId,
          publicId: generateConversionPublicId(),
          itemId: item.id,
          fromUnitId: current.fromUnitId,
          toUnitId: current.toUnitId,
          factorMicros: validated.factorMicros,
          justification: validated.justification,
          effectiveFrom,
          effectiveTo: null,
          revision: current.revision + 1,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
        })
        .returning();
      await recordConversionAudit(tx, context, item, "inventory.conversion.revise", closed, inserted!, inserted!.revision);
      return loadItemDetailInTx(tx, tenantId, item.id);
    });
  } catch (error) {
    return mapConversionWriteError(error);
  }
}

export async function closeConversion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  conversionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedRevision = parseExpectedVersion(body.expectedRevision, "expectedRevision");
  const requestedTo = parseOptionalDate(body.effectiveFrom);
  const context = { db, tenantId, membership, actorSubject, itemPublicId, now };
  return withTenantContext(db, tenantId, async (tx) => {
    const item = await loadWritableItemInTx(tx, tenantId, itemPublicId);
    const current = await loadCurrentConversionInTx(tx, tenantId, item, conversionPublicId, expectedRevision);
    const today = await tenantToday(tx, tenantId, now);
    // A rule dated in the future ends on its own start date when no date is given.
    const effectiveTo = requestedTo ?? (current.effectiveFrom > today ? current.effectiveFrom : today);
    if (effectiveTo < current.effectiveFrom) {
      throw new InventoryError(
        `The end date cannot be earlier than the current version's date (${current.effectiveFrom}). History is not rewritten.`,
        400,
        "effective_from_before_current",
        "effectiveFrom",
      );
    }
    const closed = await closeRowInTx(tx, current.id, effectiveTo);
    await recordConversionAudit(tx, context, item, "inventory.conversion.close", current, closed, closed.revision);
    return loadItemDetailInTx(tx, tenantId, item.id);
  });
}

/** PATCH dispatcher for `{ operation: "revise" | "close", ... }`. */
export async function updateConversion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  conversionPublicId: string,
  input: unknown,
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  if (body.operation === "revise") {
    return reviseConversion(db, tenantId, membership, actorSubject, itemPublicId, conversionPublicId, body);
  }
  if (body.operation === "close") {
    return closeConversion(db, tenantId, membership, actorSubject, itemPublicId, conversionPublicId, body);
  }
  throw new InventoryError("operation must be revise or close.", 400, "operation_invalid", "operation");
}
