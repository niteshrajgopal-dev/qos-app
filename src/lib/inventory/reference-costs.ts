import { and, eq, isNull, max } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryItemRecord,
  type InventoryItemReferenceCostRecord,
  inventoryItemReferenceCosts,
  inventoryUnits,
  tenants,
} from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { majorToMicrosExact } from "@/lib/catalogue/selling-tax-cost";
import type { CostSource, CostTaxBasis } from "@/lib/inventory/cost-completeness";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import { type ItemDetailView, loadItemByPublicIdInTx, loadItemDetailInTx } from "@/lib/inventory/items";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import {
  asBody,
  loadTenantUnitsInTx,
  loadUnitByPublicIdInTx,
  parseOptionalDate,
  parseOptionalText,
  requireInventoryAdministrator,
  shortRandomHex,
  tenantToday,
  uniqueViolationConstraint,
} from "@/lib/inventory/shared";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-197 dated item reference costs. A row means "1 unit of this item is
   estimated at amount currency" from effective_from. Rows are append-only
   versions, like conversions: setting a new cost closes the current row with
   effective_to and inserts the next revision; clearing closes it with no
   successor, so the item is unknown again from that date. qos_app can update
   no column other than effective_to, so a stored amount is never rewritten.

   Amounts are exact micros (6 decimal places); more precision is refused,
   never rounded, and nothing rounds to cents. A blank amount is never a
   clear and never zero: zero is only ever an explicit "0".

   These are reference estimates for recipe costing. They are not stock
   valuation, not purchase records and not the catalogue product or modifier
   cost policies; nothing posts from them. When QOS-201/202 value a movement
   they must snapshot the cost row id, amount, unit and the conversion row
   used, so a later revision never reinterprets a posted value. */

export const SOURCE_REFERENCE_MAX_LENGTH = 200;
const TAX_BASES: readonly CostTaxBasis[] = ["net", "gross", "unconfirmed"];
const SOURCES: readonly CostSource[] = ["manual", "supplier_quote", "invoice"];

export type ReferenceCostInput = {
  amountMicros: bigint;
  currency: string | null;
  unitPublicId: string | null;
  taxBasis: CostTaxBasis;
  source: CostSource;
  sourceReference: string | null;
  effectiveFrom: string | null;
  expectedRevision: number | null;
};

/** Parses an amount string into exact micros: "12.345678" → 12345678n. Refuses, never rounds. */
export function parseCostAmount(value: unknown): bigint {
  if (value == null || (typeof value === "string" && !value.trim())) {
    throw new InventoryError(
      "Enter an amount. A blank cost stays unknown; enter 0 only for a free item.",
      400,
      "amount_required",
      "amount",
    );
  }
  if (typeof value !== "string") {
    throw new InventoryError("Enter the amount as a plain decimal number.", 400, "amount_invalid", "amount");
  }
  const result = majorToMicrosExact(value);
  if (result.status === "ok") {
    return result.value;
  }
  if (result.status === "invalid" && result.reason === "negative") {
    throw new InventoryError("The amount cannot be negative.", 400, "amount_negative", "amount");
  }
  if (result.status === "invalid" && result.reason === "too_precise") {
    throw new InventoryError("The amount can have at most 6 decimal places.", 400, "amount_too_precise", "amount");
  }
  throw new InventoryError("Enter the amount as a plain decimal number.", 400, "amount_invalid", "amount");
}

function parseTaxBasis(value: unknown): CostTaxBasis {
  if (!TAX_BASES.includes(value as CostTaxBasis)) {
    throw new InventoryError("Choose net, gross or unconfirmed.", 400, "tax_basis_invalid", "taxBasis");
  }
  return value as CostTaxBasis;
}

function parseSource(value: unknown): CostSource {
  if (!SOURCES.includes(value as CostSource)) {
    throw new InventoryError("Choose manual, supplier quote or invoice.", 400, "cost_source_invalid", "source");
  }
  return value as CostSource;
}

function parseExpectedRevision(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new InventoryError("expectedRevision is required.", 400, "expected_version_required", "expectedRevision");
  }
  return value;
}

function parseOptionalCurrency(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new InventoryError("Only this business's currency is accepted.", 400, "currency_not_supported", "currency");
  }
  return value.trim().toUpperCase();
}

/**
 * Parses a set-cost body. `expectedRevision` is required: the current row's
 * revision, or `null` when the item has no current cost.
 */
export function parseReferenceCostInput(input: unknown): ReferenceCostInput {
  const body = asBody(input);
  const amountMicros = parseCostAmount(body.amount);
  if (!("expectedRevision" in body)) {
    throw new InventoryError("expectedRevision is required.", 400, "expected_version_required", "expectedRevision");
  }
  const unitPublicId = body.unitPublicId;
  if (unitPublicId != null && unitPublicId !== "" && typeof unitPublicId !== "string") {
    throw new InventoryError("Unit not found.", 404, "unit_not_found", "unitPublicId");
  }
  return {
    amountMicros,
    currency: parseOptionalCurrency(body.currency),
    unitPublicId: typeof unitPublicId === "string" && unitPublicId ? unitPublicId : null,
    taxBasis: parseTaxBasis(body.taxBasis),
    source: parseSource(body.source),
    sourceReference: parseOptionalText(body.sourceReference, "sourceReference", SOURCE_REFERENCE_MAX_LENGTH),
    effectiveFrom: parseOptionalDate(body.effectiveFrom),
    expectedRevision: parseExpectedRevision(body.expectedRevision),
  };
}

function generateCostPublicId() {
  return `cost_${shortRandomHex(20)}`;
}

function staleCost(): InventoryConflictError {
  return new InventoryConflictError(
    "This cost changed elsewhere. Reload and try again.",
    "expected_version_mismatch",
    "expectedRevision",
  );
}

/** Locks the item so concurrent cost writes for it serialise. */
async function loadWritableItemInTx(tx: DbClient, tenantId: string, itemPublicId: string): Promise<InventoryItemRecord> {
  const item = await loadItemByPublicIdInTx(tx, tenantId, itemPublicId, "update");
  if (item.status !== "active") {
    throw new InventoryConflictError(
      "This item is archived. Restore it before changing its conversions or cost.",
      "item_archived",
      "itemPublicId",
    );
  }
  return item;
}

async function loadCurrentCostInTx(tx: DbClient, tenantId: string, itemId: string) {
  const [row] = await tx
    .select()
    .from(inventoryItemReferenceCosts)
    .where(
      and(
        eq(inventoryItemReferenceCosts.tenantId, tenantId),
        eq(inventoryItemReferenceCosts.itemId, itemId),
        isNull(inventoryItemReferenceCosts.effectiveTo),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Sets effective_to on the current row only; qos_app has no UPDATE grant on any other column. */
async function closeRowInTx(tx: DbClient, rowId: string, effectiveTo: string) {
  const closed = await tx
    .update(inventoryItemReferenceCosts)
    .set({ effectiveTo })
    .where(and(eq(inventoryItemReferenceCosts.id, rowId), isNull(inventoryItemReferenceCosts.effectiveTo)))
    .returning();
  if (closed.length !== 1) {
    throw staleCost();
  }
  return closed[0]!;
}

async function resolveCurrency(tx: DbClient, tenantId: string, requested: string | null) {
  const [tenant] = await tx
    .select({ baseCurrency: tenants.baseCurrency })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const base = tenant!.baseCurrency;
  if (requested !== null && requested !== base) {
    throw new InventoryError("Only this business's currency is accepted.", 400, "currency_not_supported", "currency");
  }
  return base;
}

/** The cost unit must be one of the item's designated units and active. Default: the storage unit. */
async function resolveCostUnit(tx: DbClient, tenantId: string, item: InventoryItemRecord, unitPublicId: string | null) {
  const designated = [item.storageUnitId, item.recipeUnitId, item.purchaseUnitId].filter((id): id is string => id !== null);
  if (unitPublicId === null) {
    if (!item.storageUnitId) {
      throw new InventoryError(
        "Choose a unit for this cost. Set a storage, recipe or purchase unit on the item first.",
        400,
        "cost_unit_not_designated",
        "unitPublicId",
      );
    }
    const [storage] = await tx
      .select()
      .from(inventoryUnits)
      .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, item.storageUnitId)))
      .limit(1)
      .for("share");
    return assertActive(storage!);
  }
  const unit = await loadUnitByPublicIdInTx(tx, tenantId, unitPublicId, "unitPublicId");
  if (!designated.includes(unit.id)) {
    throw new InventoryError(
      "A cost must be per the item's storage, recipe or purchase unit.",
      400,
      "cost_unit_not_designated",
      "unitPublicId",
    );
  }
  return assertActive(unit);
}

function assertActive<T extends { status: "active" | "archived" }>(unit: T): T {
  if (unit.status !== "active") {
    throw new InventoryError("Archived units cannot be used here. Restore the unit first.", 400, "unit_archived", "unitPublicId");
  }
  return unit;
}

async function recordCostAudit(
  tx: DbClient,
  context: { tenantId: string; actorSubject: string; membership: ActiveStaffMembership },
  item: InventoryItemRecord,
  action: "inventory.reference_cost.create" | "inventory.reference_cost.revise" | "inventory.reference_cost.close",
  before: InventoryItemReferenceCostRecord | null,
  after: InventoryItemReferenceCostRecord | null,
  revision: number,
) {
  const codes = new Map((await loadTenantUnitsInTx(tx, context.tenantId)).map((unit) => [unit.id, unit.code]));
  const summary = (row: InventoryItemReferenceCostRecord | null) =>
    row
      ? {
          costPublicId: row.publicId,
          amount: microsToDecimalString(row.amountMicros),
          amountMicros: row.amountMicros.toString(),
          currency: row.currency,
          unit: codes.get(row.unitId) ?? row.unitId,
          taxBasis: row.taxBasis,
          source: row.source,
          sourceReference: row.sourceReference,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          revision: row.revision,
        }
      : null;
  await recordTenantAuditEventInTx(tx, {
    tenantId: context.tenantId,
    actorSubject: context.actorSubject,
    actorClass: auditActorClassFromStaffRole(context.membership.role),
    action,
    entityType: "inventory_item_reference_cost",
    entityPublicId: item.publicId,
    entityVersion: revision,
    changeSummary: {
      costPublicId: (after ?? before)!.publicId,
      before: summary(before),
      after: summary(after),
    },
  });
}

/**
 * Sets the item's reference cost. With a current cost this closes it on the
 * new effective date and inserts the next revision; without one it starts the
 * next revision (1, or after a cleared history).
 */
export async function setReferenceCost(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const parsed = parseReferenceCostInput(input);
  const context = { tenantId, actorSubject, membership };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const item = await loadWritableItemInTx(tx, tenantId, itemPublicId);
      const currency = await resolveCurrency(tx, tenantId, parsed.currency);
      const unit = await resolveCostUnit(tx, tenantId, item, parsed.unitPublicId);
      const current = await loadCurrentCostInTx(tx, tenantId, item.id);
      if ((current?.revision ?? null) !== parsed.expectedRevision) {
        throw staleCost();
      }
      const [latest] = await tx
        .select({ revision: max(inventoryItemReferenceCosts.revision), effectiveTo: max(inventoryItemReferenceCosts.effectiveTo) })
        .from(inventoryItemReferenceCosts)
        .where(and(eq(inventoryItemReferenceCosts.tenantId, tenantId), eq(inventoryItemReferenceCosts.itemId, item.id)));
      // Without a date the cost starts today, or on the current (or last ended) version's date if that is later.
      const floor = current?.effectiveFrom ?? latest?.effectiveTo ?? null;
      const today = await tenantToday(tx, tenantId, now);
      const effectiveFrom = parsed.effectiveFrom ?? (floor && floor > today ? floor : today);
      if (floor && effectiveFrom < floor) {
        throw new InventoryError(
          `The effective date cannot be earlier than ${floor}, the date of the current or last cost version. History is not rewritten.`,
          400,
          "effective_from_before_current",
          "effectiveFrom",
        );
      }
      const closed = current ? await closeRowInTx(tx, current.id, effectiveFrom) : null;
      const [inserted] = await tx
        .insert(inventoryItemReferenceCosts)
        .values({
          tenantId,
          publicId: generateCostPublicId(),
          itemId: item.id,
          unitId: unit.id,
          amountMicros: parsed.amountMicros,
          currency,
          taxBasis: parsed.taxBasis,
          source: parsed.source,
          sourceReference: parsed.sourceReference,
          effectiveFrom,
          effectiveTo: null,
          revision: (latest?.revision ?? 0) + 1,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
        })
        .returning();
      await recordCostAudit(
        tx,
        context,
        item,
        closed ? "inventory.reference_cost.revise" : "inventory.reference_cost.create",
        closed,
        inserted!,
        inserted!.revision,
      );
      return loadItemDetailInTx(tx, tenantId, item.id);
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) !== null) {
      throw staleCost();
    }
    throw error;
  }
}

/** Ends the current cost with no successor: the item's cost is unknown again from that date. */
export async function closeReferenceCost(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  costPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedRevision = parseExpectedRevision(body.expectedRevision);
  if (expectedRevision === null) {
    throw new InventoryError("expectedRevision is required.", 400, "expected_version_required", "expectedRevision");
  }
  const requestedTo = parseOptionalDate(body.effectiveFrom);
  const context = { tenantId, actorSubject, membership };
  return withTenantContext(db, tenantId, async (tx) => {
    const item = await loadWritableItemInTx(tx, tenantId, itemPublicId);
    const [row] = await tx
      .select()
      .from(inventoryItemReferenceCosts)
      .where(
        and(
          eq(inventoryItemReferenceCosts.tenantId, tenantId),
          eq(inventoryItemReferenceCosts.itemId, item.id),
          eq(inventoryItemReferenceCosts.publicId, costPublicId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new InventoryError("Reference cost not found.", 404, "reference_cost_not_found", "costPublicId");
    }
    if (row.effectiveTo !== null) {
      throw new InventoryConflictError(
        "This cost version is no longer current. Reload to see the current cost.",
        "reference_cost_not_current",
        "costPublicId",
      );
    }
    if (row.revision !== expectedRevision) {
      throw staleCost();
    }
    const today = await tenantToday(tx, tenantId, now);
    // A cost dated in the future ends on its own start date when no date is given.
    const effectiveTo = requestedTo ?? (row.effectiveFrom > today ? row.effectiveFrom : today);
    if (effectiveTo < row.effectiveFrom) {
      throw new InventoryError(
        `The end date cannot be earlier than the current version's date (${row.effectiveFrom}). History is not rewritten.`,
        400,
        "effective_from_before_current",
        "effectiveFrom",
      );
    }
    const closed = await closeRowInTx(tx, row.id, effectiveTo);
    await recordCostAudit(tx, context, item, "inventory.reference_cost.close", row, closed, closed.revision);
    return loadItemDetailInTx(tx, tenantId, item.id);
  });
}

/** PATCH dispatcher. Only `{ operation: "close" }`: a new amount always goes through POST. */
export async function updateReferenceCost(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  costPublicId: string,
  input: unknown,
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  if (body.operation === "close") {
    return closeReferenceCost(db, tenantId, membership, actorSubject, itemPublicId, costPublicId, body);
  }
  throw new InventoryError("operation must be close.", 400, "operation_invalid", "operation");
}
