import { and, count, eq, isNull, or } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryUnitRecord,
  inventoryItemConversions,
  inventoryItemReferenceCosts,
  inventoryItems,
  inventoryUnits,
  recipes,
  recipeSellableLinks,
  recipeVersionLines,
  recipeVersions,
} from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import {
  asBody,
  loadTenantUnitsInTx,
  loadUnitByPublicIdInTx,
  parseExpectedVersion,
  parseRequiredName,
  parseStatus,
  requireInventoryAdministrator,
  shortRandomHex,
  slugify,
  tenantToday,
  toUnitView,
  uniqueViolationConstraint,
  type UnitView,
  versionConflict,
} from "@/lib/inventory/shared";
import {
  isQuantityKind,
  type QuantityKind,
  STANDARD_UNITS,
  standardUnit,
  type StandardUnitCode,
} from "@/lib/inventory/standard-units";
import { isOpenOn, versionPhase } from "@/lib/recipes/dates";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-195 tenant units. A unit's identity is its public id; its code is
   immutable after create (audit, previews and future movement snapshots
   quote it), and renames only change the display names. Standard units are
   opt-in rows tied to the constants in standard-units.ts. Units are never
   deleted; archiving is refused while an item, a current rule, a current
   reference cost (QOS-197) or a recipe or sellable link (QOS-198) uses one. */

export const UNIT_NAME_MAX_LENGTH = 80;
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export type StandardUnitView = {
  code: StandardUnitCode;
  nameEn: string;
  nameAr: string;
  quantityKind: QuantityKind;
  defaultDecimalPlaces: number;
  /** Public id of the tenant's unit for this standard, when it has been added. */
  alreadyAdded: string | null;
};

/**
 * QOS-197 adds `currentCosts`: current item reference costs priced per this
 * unit. QOS-198 adds `recipeUsages`: yields and active lines of open drafts
 * and current or scheduled approved versions of active recipes, and
 * direct-stock links that have not ended.
 */
export type UnitUsage = { itemDesignations: number; currentRules: number; currentCosts: number; recipeUsages: number };

export type CreateUnitInput =
  | {
      source: "standard";
      standardCode: string;
      decimalPlaces?: number;
      nameEn?: string;
      nameAr?: string;
    }
  | {
      source: "custom";
      code: string;
      nameEn: string;
      nameAr: string;
      quantityKind: string;
      decimalPlaces: number;
    };

export type UpdateUnitInput = {
  expectedVersion: number;
  nameEn?: string;
  nameAr?: string;
  decimalPlaces?: number;
  status?: "active" | "archived";
};

function parseDecimalPlaces(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) {
    throw new InventoryError(
      "Decimal places must be a whole number from 0 to 6.",
      400,
      "decimal_places_out_of_range",
      "decimalPlaces",
    );
  }
  return value;
}

function mapUnitWriteError(error: unknown): never {
  const constraint = uniqueViolationConstraint(error);
  if (constraint === "inventory_units_tenant_standard_code_unique") {
    throw new InventoryConflictError("This standard unit has already been added.", "standard_code_taken", "standardCode");
  }
  if (constraint !== null) {
    throw new InventoryConflictError("Another unit already uses this code.", "unit_code_taken", "code");
  }
  throw error;
}

function generateUnitPublicId(code: string) {
  return `unit_${slugify(code, "unit")}_${shortRandomHex(8)}`;
}

export async function loadUnitUsageInTx(tx: DbClient, tenantId: string, unitId: string): Promise<UnitUsage> {
  const [designations] = await tx
    .select({ value: count() })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.status, "active"),
        or(
          eq(inventoryItems.storageUnitId, unitId),
          eq(inventoryItems.recipeUnitId, unitId),
          eq(inventoryItems.purchaseUnitId, unitId),
        ),
      ),
    );
  const [rules] = await tx
    .select({ value: count() })
    .from(inventoryItemConversions)
    .where(
      and(
        eq(inventoryItemConversions.tenantId, tenantId),
        isNull(inventoryItemConversions.effectiveTo),
        or(eq(inventoryItemConversions.fromUnitId, unitId), eq(inventoryItemConversions.toUnitId, unitId)),
      ),
    );
  const [costs] = await tx
    .select({ value: count() })
    .from(inventoryItemReferenceCosts)
    .where(
      and(
        eq(inventoryItemReferenceCosts.tenantId, tenantId),
        eq(inventoryItemReferenceCosts.unitId, unitId),
        isNull(inventoryItemReferenceCosts.effectiveTo),
      ),
    );
  return {
    itemDesignations: designations?.value ?? 0,
    currentRules: rules?.value ?? 0,
    currentCosts: costs?.value ?? 0,
    recipeUsages: await countRecipeUsagesInTx(tx, tenantId, unitId),
  };
}

async function countRecipeUsagesInTx(tx: DbClient, tenantId: string, unitId: string): Promise<number> {
  const today = await tenantToday(tx, tenantId);
  const versions = (
    await tx
      .select({
        id: recipeVersions.id,
        status: recipeVersions.status,
        effectiveFrom: recipeVersions.effectiveFrom,
        effectiveTo: recipeVersions.effectiveTo,
        yieldUnitId: recipeVersions.yieldUnitId,
      })
      .from(recipeVersions)
      .innerJoin(recipes, and(eq(recipes.tenantId, recipeVersions.tenantId), eq(recipes.id, recipeVersions.recipeId)))
      .where(and(eq(recipeVersions.tenantId, tenantId), eq(recipes.status, "active")))
  ).filter((version) => ["draft", "current", "scheduled"].includes(versionPhase(version, today)));
  const liveVersionIds = new Set(versions.map((version) => version.id));
  const lines = await tx
    .select({ versionId: recipeVersionLines.recipeVersionId })
    .from(recipeVersionLines)
    .where(
      and(eq(recipeVersionLines.tenantId, tenantId), eq(recipeVersionLines.unitId, unitId), eq(recipeVersionLines.status, "active")),
    );
  const links = await tx
    .select({ effectiveTo: recipeSellableLinks.effectiveTo })
    .from(recipeSellableLinks)
    .where(and(eq(recipeSellableLinks.tenantId, tenantId), eq(recipeSellableLinks.unitId, unitId)));
  return (
    versions.filter((version) => version.yieldUnitId === unitId).length +
    lines.filter((line) => liveVersionIds.has(line.versionId)).length +
    links.filter((link) => isOpenOn(link.effectiveTo, today)).length
  );
}

function standardUnitViews(units: InventoryUnitRecord[]): StandardUnitView[] {
  return STANDARD_UNITS.map((definition) => ({
    code: definition.code,
    nameEn: definition.nameEn,
    nameAr: definition.nameAr,
    quantityKind: definition.dimension,
    defaultDecimalPlaces: definition.defaultDecimalPlaces,
    alreadyAdded: units.find((unit) => unit.standardCode === definition.code)?.publicId ?? null,
  }));
}

export async function listUnits(
  db: DbClient,
  tenantId: string,
): Promise<{ units: UnitView[]; standardUnits: StandardUnitView[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const units = await loadTenantUnitsInTx(tx, tenantId);
    return { units: units.map(toUnitView), standardUnits: standardUnitViews(units) };
  });
}

export async function getUnit(
  db: DbClient,
  tenantId: string,
  unitPublicId: string,
): Promise<{ unit: UnitView; usage: UnitUsage }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [unit] = await tx
      .select()
      .from(inventoryUnits)
      .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.publicId, unitPublicId)))
      .limit(1);
    if (!unit) {
      throw new InventoryError("Unit not found.", 404, "unit_not_found", "unitPublicId");
    }
    return { unit: toUnitView(unit), usage: await loadUnitUsageInTx(tx, tenantId, unit.id) };
  });
}

type ValidatedCreate = {
  code: string;
  nameEn: string;
  nameAr: string;
  quantityKind: QuantityKind;
  standardCode: StandardUnitCode | null;
  decimalPlaces: number;
};

export function validateCreateUnitInput(input: unknown): ValidatedCreate {
  const body = asBody(input);
  if (body.source === "standard") {
    const definition = standardUnit(typeof body.standardCode === "string" ? body.standardCode : null);
    if (!definition) {
      throw new InventoryError("Choose a standard unit from the list.", 400, "standard_code_unknown", "standardCode");
    }
    return {
      code: definition.code,
      nameEn: body.nameEn == null ? definition.nameEn : parseRequiredName(body.nameEn, "nameEn", UNIT_NAME_MAX_LENGTH),
      nameAr: body.nameAr == null ? definition.nameAr : parseRequiredName(body.nameAr, "nameAr", UNIT_NAME_MAX_LENGTH),
      quantityKind: definition.dimension,
      standardCode: definition.code,
      decimalPlaces: body.decimalPlaces == null ? definition.defaultDecimalPlaces : parseDecimalPlaces(body.decimalPlaces),
    };
  }
  if (body.source !== "custom") {
    throw new InventoryError("Choose a standard or a custom unit.", 400, "source_invalid", "source");
  }
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!CODE_PATTERN.test(code)) {
    throw new InventoryError(
      "Use 1 to 24 lowercase letters, digits, hyphens or underscores for the code, starting with a letter or digit.",
      400,
      "code_invalid",
      "code",
    );
  }
  if (standardUnit(code)) {
    throw new InventoryError(
      `${code} is a standard unit code. Add it as a standard unit so its exact conversions apply.`,
      400,
      "code_reserved_for_standard",
      "code",
    );
  }
  if (!isQuantityKind(body.quantityKind)) {
    throw new InventoryError("Choose mass, volume, count or pack.", 400, "quantity_kind_invalid", "quantityKind");
  }
  return {
    code,
    nameEn: parseRequiredName(body.nameEn, "nameEn", UNIT_NAME_MAX_LENGTH),
    nameAr: parseRequiredName(body.nameAr, "nameAr", UNIT_NAME_MAX_LENGTH),
    quantityKind: body.quantityKind,
    standardCode: null,
    decimalPlaces: parseDecimalPlaces(body.decimalPlaces),
  };
}

export async function createUnit(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
): Promise<UnitView> {
  requireInventoryAdministrator(membership);
  const validated = validateCreateUnitInput(input);
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const [existingCode] = await tx
        .select({ standardCode: inventoryUnits.standardCode })
        .from(inventoryUnits)
        .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.code, validated.code)))
        .limit(1);
      if (existingCode) {
        if (validated.standardCode && existingCode.standardCode === validated.standardCode) {
          throw new InventoryConflictError("This standard unit has already been added.", "standard_code_taken", "standardCode");
        }
        throw new InventoryConflictError("Another unit already uses this code.", "unit_code_taken", "code");
      }
      const [row] = await tx
        .insert(inventoryUnits)
        .values({
          tenantId,
          publicId: generateUnitPublicId(validated.code),
          ...validated,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "inventory.unit.create",
        entityType: "inventory_unit",
        entityPublicId: row!.publicId,
        entityVersion: row!.version,
        changeSummary: { after: auditUnit(row!) },
      });
      return toUnitView(row!);
    });
  } catch (error) {
    return mapUnitWriteError(error);
  }
}

function auditUnit(row: InventoryUnitRecord) {
  return {
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    quantityKind: row.quantityKind,
    standardCode: row.standardCode,
    decimalPlaces: row.decimalPlaces,
    status: row.status,
  };
}

const IMMUTABLE_UNIT_FIELDS = ["code", "quantityKind", "standardCode", "source"] as const;

export function validateUpdateUnitInput(input: unknown) {
  const body = asBody(input);
  for (const field of IMMUTABLE_UNIT_FIELDS) {
    if (field in body) {
      throw new InventoryError(
        "A unit's code, kind and standard link cannot change after it is created. Rename the unit instead.",
        400,
        "immutable_field",
        field,
      );
    }
  }
  return {
    expectedVersion: parseExpectedVersion(body.expectedVersion),
    nameEn: body.nameEn === undefined ? undefined : parseRequiredName(body.nameEn, "nameEn", UNIT_NAME_MAX_LENGTH),
    nameAr: body.nameAr === undefined ? undefined : parseRequiredName(body.nameAr, "nameAr", UNIT_NAME_MAX_LENGTH),
    decimalPlaces: body.decimalPlaces === undefined ? undefined : parseDecimalPlaces(body.decimalPlaces),
    status: parseStatus(body.status),
  };
}

export async function updateUnit(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  unitPublicId: string,
  input: unknown,
): Promise<UnitView> {
  requireInventoryAdministrator(membership);
  const validated = validateUpdateUnitInput(input);
  return withTenantContext(db, tenantId, async (tx) => {
    const unit = await loadUnitByPublicIdInTx(tx, tenantId, unitPublicId, "unitPublicId", "update");
    if (unit.version !== validated.expectedVersion) {
      throw versionConflict();
    }
    const nextStatus = validated.status ?? unit.status;
    if (nextStatus === "archived" && unit.status !== "archived") {
      const usage = await loadUnitUsageInTx(tx, tenantId, unit.id);
      if (usage.itemDesignations > 0 || usage.currentRules > 0 || usage.currentCosts > 0 || usage.recipeUsages > 0) {
        throw new InventoryConflictError(
          "This unit is used by an item, a current conversion, a current cost or a recipe and cannot be archived.",
          "unit_in_use",
          "status",
        );
      }
    }
    const [updated] = await tx
      .update(inventoryUnits)
      .set({
        nameEn: validated.nameEn ?? unit.nameEn,
        nameAr: validated.nameAr ?? unit.nameAr,
        decimalPlaces: validated.decimalPlaces ?? unit.decimalPlaces,
        status: nextStatus,
        version: unit.version + 1,
        updatedAt: new Date(),
        updatedBySubject: actorSubject,
      })
      .where(and(eq(inventoryUnits.id, unit.id), eq(inventoryUnits.version, validated.expectedVersion)))
      .returning();
    if (!updated) {
      throw versionConflict();
    }
    const action =
      nextStatus !== unit.status
        ? nextStatus === "archived"
          ? "inventory.unit.archive"
          : "inventory.unit.restore"
        : "inventory.unit.update";
    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action,
      entityType: "inventory_unit",
      entityPublicId: updated.publicId,
      entityVersion: updated.version,
      changeSummary: { before: auditUnit(unit), after: auditUnit(updated) },
    });
    return toUnitView(updated);
  });
}
