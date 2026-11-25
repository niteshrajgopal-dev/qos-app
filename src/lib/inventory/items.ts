import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryCategoryRecord,
  type InventoryItemConversionRecord,
  type InventoryItemRecord,
  type InventoryItemReferenceCostRecord,
  type InventorySupplierRecord,
  type InventoryUnitRecord,
  inventoryItemConversions,
  inventoryItemReferenceCosts,
  inventoryItems,
  inventorySuppliers,
} from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import type { GraphRule } from "@/lib/inventory/conversion-graph";
import { explainItemQuantities, type ItemQuantityPreview, type PreviewUnit } from "@/lib/inventory/conversion-preview";
import {
  type CostSource,
  type CostTaxBasis,
  explainItemCost,
  type ItemCostExplanation,
  type ItemCostStatus,
} from "@/lib/inventory/cost-completeness";
import { type Dependency, InventoryDependencyError, InventoryError } from "@/lib/inventory/errors";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import {
  asBody,
  type CategoryView,
  loadCategoryByPublicIdInTx,
  loadSupplierByPublicIdInTx,
  loadTenantCategoriesInTx,
  loadTenantUnitsInTx,
  loadUnitByPublicIdInTx,
  parseExpectedVersion,
  parseOptionalName,
  parseOptionalNotes,
  parseRequiredName,
  parseStatus,
  requireInventoryAdministrator,
  shortRandomHex,
  slugify,
  type SupplierView,
  toCategoryView,
  toSupplierView,
  toUnitView,
  type UnitView,
  versionConflict,
} from "@/lib/inventory/shared";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-195 inventory items: the minimal identity (public id, names, kind,
   status and storage/recipe/purchase unit designations) that item-scoped
   conversions hang off. QOS-196 adds the default supplier; QOS-197 adds the
   category, notes and the dated reference cost (reference-costs.ts). An
   ingredient is an item: there is no separate ingredients table. Names are
   not identity: a rename keeps the public id, every rule, cost and link.
   A prepared item is a definition only; saving one posts nothing. */

export const ITEM_NAME_MAX_LENGTH = 120;
export type InventoryItemKind = "purchased" | "prepared";

export type ItemView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: InventoryItemKind;
  status: "active" | "archived";
  version: number;
  storageUnitPublicId: string | null;
  recipeUnitPublicId: string | null;
  purchaseUnitPublicId: string | null;
  defaultSupplierPublicId: string | null;
  categoryPublicId: string | null;
  notes: string | null;
  provenance: InventoryItemRecord["provenance"];
  createdAt: string;
  updatedAt: string;
};

export type ReferenceCostView = {
  publicId: string;
  unitPublicId: string;
  unitCode: string;
  /** Exact decimal string of the stored amount, for 1 unit. */
  amount: string;
  amountMicros: string;
  currency: string;
  taxBasis: CostTaxBasis;
  source: CostSource;
  sourceReference: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  revision: number;
  current: boolean;
  provenance: InventoryItemReferenceCostRecord["provenance"];
  createdAt: string;
};

export type ConversionView = {
  publicId: string;
  fromUnitPublicId: string;
  toUnitPublicId: string;
  fromCode: string;
  toCode: string;
  /** Exact decimal string of the stored factor: 1 from = factor to. */
  factor: string;
  factorMicros: string;
  justification: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  revision: number;
  current: boolean;
  provenance: InventoryItemConversionRecord["provenance"];
  createdAt: string;
};

export type ItemSummaryView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: InventoryItemKind;
  status: "active" | "archived";
  version: number;
  storageUnitCode: string | null;
  recipeUnitCode: string | null;
  purchaseUnitCode: string | null;
  defaultSupplierPublicId: string | null;
  categoryPublicId: string | null;
  currentRuleCount: number;
  previewStatus: ItemQuantityPreview["status"];
  costStatus: ItemCostStatus;
  /** The current reference cost as entered; null when the cost is unknown. */
  costSummary: { amount: string; currency: string; unitCode: string } | null;
};

export type ItemDetailView = {
  item: ItemView;
  /** Active units plus any archived unit this item still references. */
  units: UnitView[];
  /** Active suppliers plus the archived default supplier this item still references. */
  suppliers: SupplierView[];
  /** Active categories plus the archived category this item still references. */
  categories: CategoryView[];
  rules: ConversionView[];
  history: ConversionView[];
  preview: ItemQuantityPreview;
  /** Current reference cost explained per storage and recipe unit, or unknown. */
  referenceCost: ItemCostExplanation;
  /** Every reference cost version, newest first. */
  costHistory: ReferenceCostView[];
};

function previewUnit(unit: InventoryUnitRecord): PreviewUnit {
  return {
    id: unit.id,
    publicId: unit.publicId,
    code: unit.code,
    nameEn: unit.nameEn,
    nameAr: unit.nameAr,
    quantityKind: unit.quantityKind,
    standardCode: unit.standardCode,
    decimalPlaces: unit.decimalPlaces,
    status: unit.status,
  };
}

function graphRule(row: InventoryItemConversionRecord): GraphRule {
  return { id: row.id, fromUnitId: row.fromUnitId, toUnitId: row.toUnitId, factorMicros: row.factorMicros };
}

export function costForItem(
  item: InventoryItemRecord,
  units: InventoryUnitRecord[],
  currentRules: InventoryItemConversionRecord[],
  currentCost: InventoryItemReferenceCostRecord | null,
): ItemCostExplanation {
  return explainItemCost({
    storageUnitId: item.storageUnitId,
    recipeUnitId: item.recipeUnitId,
    units: units.map(previewUnit),
    rules: currentRules.map(graphRule),
    cost: currentCost
      ? {
          publicId: currentCost.publicId,
          unitId: currentCost.unitId,
          amountMicros: currentCost.amountMicros,
          currency: currentCost.currency,
          taxBasis: currentCost.taxBasis,
          source: currentCost.source,
          sourceReference: currentCost.sourceReference,
          effectiveFrom: currentCost.effectiveFrom,
          revision: currentCost.revision,
        }
      : null,
  });
}

export function previewForItem(
  item: InventoryItemRecord,
  units: InventoryUnitRecord[],
  currentRules: InventoryItemConversionRecord[],
): ItemQuantityPreview {
  return explainItemQuantities({
    storageUnitId: item.storageUnitId,
    recipeUnitId: item.recipeUnitId,
    purchaseUnitId: item.purchaseUnitId,
    units: units.map(previewUnit),
    rules: currentRules.map(graphRule),
  });
}

function toItemView(
  item: InventoryItemRecord,
  unitsById: Map<string, InventoryUnitRecord>,
  suppliersById: Map<string, InventorySupplierRecord>,
  categoriesById: Map<string, InventoryCategoryRecord>,
): ItemView {
  const publicIdOf = (id: string | null) => (id ? unitsById.get(id)?.publicId ?? null : null);
  return {
    publicId: item.publicId,
    nameEn: item.nameEn,
    nameAr: item.nameAr,
    kind: item.kind,
    status: item.status,
    version: item.version,
    storageUnitPublicId: publicIdOf(item.storageUnitId),
    recipeUnitPublicId: publicIdOf(item.recipeUnitId),
    purchaseUnitPublicId: publicIdOf(item.purchaseUnitId),
    defaultSupplierPublicId: item.defaultSupplierId ? suppliersById.get(item.defaultSupplierId)?.publicId ?? null : null,
    categoryPublicId: item.categoryId ? categoriesById.get(item.categoryId)?.publicId ?? null : null,
    notes: item.notes,
    provenance: item.provenance,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toConversionView(row: InventoryItemConversionRecord, unitsById: Map<string, InventoryUnitRecord>): ConversionView {
  const from = unitsById.get(row.fromUnitId)!;
  const to = unitsById.get(row.toUnitId)!;
  return {
    publicId: row.publicId,
    fromUnitPublicId: from.publicId,
    toUnitPublicId: to.publicId,
    fromCode: from.code,
    toCode: to.code,
    factor: microsToDecimalString(row.factorMicros),
    factorMicros: row.factorMicros.toString(),
    justification: row.justification,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    revision: row.revision,
    current: row.effectiveTo === null,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
  };
}

function toReferenceCostView(
  row: InventoryItemReferenceCostRecord,
  unitsById: Map<string, InventoryUnitRecord>,
): ReferenceCostView {
  const unit = unitsById.get(row.unitId)!;
  return {
    publicId: row.publicId,
    unitPublicId: unit.publicId,
    unitCode: unit.code,
    amount: microsToDecimalString(row.amountMicros),
    amountMicros: row.amountMicros.toString(),
    currency: row.currency,
    taxBasis: row.taxBasis,
    source: row.source,
    sourceReference: row.sourceReference,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    revision: row.revision,
    current: row.effectiveTo === null,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadItemByPublicIdInTx(
  tx: DbClient,
  tenantId: string,
  itemPublicId: unknown,
  lock?: "update",
): Promise<InventoryItemRecord> {
  if (typeof itemPublicId !== "string" || !itemPublicId) {
    throw new InventoryError("Item not found.", 404, "item_not_found", "itemPublicId");
  }
  const query = tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.publicId, itemPublicId)))
    .limit(1);
  const [row] = lock ? await query.for(lock) : await query;
  if (!row) {
    throw new InventoryError("Item not found.", 404, "item_not_found", "itemPublicId");
  }
  return row;
}

async function loadTenantSuppliersInTx(tx: DbClient, tenantId: string): Promise<InventorySupplierRecord[]> {
  return tx
    .select()
    .from(inventorySuppliers)
    .where(eq(inventorySuppliers.tenantId, tenantId))
    .orderBy(asc(inventorySuppliers.nameEn), asc(inventorySuppliers.publicId));
}

export async function loadItemConversionsInTx(tx: DbClient, tenantId: string, itemId: string) {
  return tx
    .select()
    .from(inventoryItemConversions)
    .where(and(eq(inventoryItemConversions.tenantId, tenantId), eq(inventoryItemConversions.itemId, itemId)))
    .orderBy(
      desc(inventoryItemConversions.effectiveFrom),
      desc(inventoryItemConversions.createdAt),
      desc(inventoryItemConversions.revision),
    );
}

export async function loadItemReferenceCostsInTx(tx: DbClient, tenantId: string, itemId: string) {
  return tx
    .select()
    .from(inventoryItemReferenceCosts)
    .where(and(eq(inventoryItemReferenceCosts.tenantId, tenantId), eq(inventoryItemReferenceCosts.itemId, itemId)))
    .orderBy(desc(inventoryItemReferenceCosts.revision));
}

export async function loadItemDetailInTx(tx: DbClient, tenantId: string, itemId: string): Promise<ItemDetailView> {
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.id, itemId)))
    .limit(1);
  if (!item) {
    throw new InventoryError("Item not found.", 404, "item_not_found", "itemPublicId");
  }
  const units = await loadTenantUnitsInTx(tx, tenantId);
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const suppliers = await loadTenantSuppliersInTx(tx, tenantId);
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const categories = await loadTenantCategoriesInTx(tx, tenantId);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const history = await loadItemConversionsInTx(tx, tenantId, item.id);
  const current = history.filter((row) => row.effectiveTo === null);
  const costHistory = await loadItemReferenceCostsInTx(tx, tenantId, item.id);
  const currentCost = costHistory.find((row) => row.effectiveTo === null) ?? null;
  const referenced = new Set<string>(
    [
      item.storageUnitId,
      item.recipeUnitId,
      item.purchaseUnitId,
      ...history.flatMap((row) => [row.fromUnitId, row.toUnitId]),
      ...costHistory.map((row) => row.unitId),
    ].filter((id): id is string => id !== null),
  );
  return {
    item: toItemView(item, unitsById, suppliersById, categoriesById),
    units: units.filter((unit) => unit.status === "active" || referenced.has(unit.id)).map(toUnitView),
    suppliers: suppliers
      .filter((supplier) => supplier.status === "active" || supplier.id === item.defaultSupplierId)
      .map(toSupplierView),
    categories: categories
      .filter((category) => category.status === "active" || category.id === item.categoryId)
      .map(toCategoryView),
    rules: current.map((row) => toConversionView(row, unitsById)),
    history: history.map((row) => toConversionView(row, unitsById)),
    preview: previewForItem(item, units, current),
    referenceCost: costForItem(item, units, current, currentCost),
    costHistory: costHistory.map((row) => toReferenceCostView(row, unitsById)),
  };
}

export async function listItems(db: DbClient, tenantId: string): Promise<{ items: ItemSummaryView[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const items = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.tenantId, tenantId))
      .orderBy(asc(inventoryItems.nameEn), asc(inventoryItems.publicId));
    const units = await loadTenantUnitsInTx(tx, tenantId);
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));
    const suppliersById = new Map((await loadTenantSuppliersInTx(tx, tenantId)).map((supplier) => [supplier.id, supplier]));
    const categoriesById = new Map((await loadTenantCategoriesInTx(tx, tenantId)).map((category) => [category.id, category]));
    const currentRules = await tx
      .select()
      .from(inventoryItemConversions)
      .where(and(eq(inventoryItemConversions.tenantId, tenantId), isNull(inventoryItemConversions.effectiveTo)));
    const currentCosts = new Map(
      (
        await tx
          .select()
          .from(inventoryItemReferenceCosts)
          .where(and(eq(inventoryItemReferenceCosts.tenantId, tenantId), isNull(inventoryItemReferenceCosts.effectiveTo)))
      ).map((row) => [row.itemId, row]),
    );
    const codeOf = (id: string | null) => (id ? unitsById.get(id)?.code ?? null : null);
    return {
      items: items.map((item) => {
        const rules = currentRules.filter((rule) => rule.itemId === item.id);
        const cost = costForItem(item, units, rules, currentCosts.get(item.id) ?? null);
        return {
          publicId: item.publicId,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          kind: item.kind,
          status: item.status,
          version: item.version,
          storageUnitCode: codeOf(item.storageUnitId),
          recipeUnitCode: codeOf(item.recipeUnitId),
          purchaseUnitCode: codeOf(item.purchaseUnitId),
          defaultSupplierPublicId: item.defaultSupplierId
            ? suppliersById.get(item.defaultSupplierId)?.publicId ?? null
            : null,
          categoryPublicId: item.categoryId ? categoriesById.get(item.categoryId)?.publicId ?? null : null,
          currentRuleCount: rules.length,
          previewStatus: previewForItem(item, units, rules).status,
          costStatus: cost.status,
          costSummary:
            cost.status === "unknown" ? null : { amount: cost.amount, currency: cost.currency, unitCode: cost.unit.code },
        };
      }),
    };
  });
}

export async function getItem(db: DbClient, tenantId: string, itemPublicId: string): Promise<ItemDetailView> {
  return withTenantContext(db, tenantId, async (tx) => {
    const item = await loadItemByPublicIdInTx(tx, tenantId, itemPublicId);
    return loadItemDetailInTx(tx, tenantId, item.id);
  });
}

function parseKind(value: unknown): InventoryItemKind {
  if (value !== "purchased" && value !== "prepared") {
    throw new InventoryError("Choose purchased or prepared.", 400, "kind_invalid", "kind");
  }
  return value;
}

const DESIGNATIONS = [
  { field: "storageUnitPublicId", column: "storageUnitId" },
  { field: "recipeUnitPublicId", column: "recipeUnitId" },
  { field: "purchaseUnitPublicId", column: "purchaseUnitId" },
] as const;

type DesignationColumns = { storageUnitId?: string | null; recipeUnitId?: string | null; purchaseUnitId?: string | null };

/** Resolves designation public ids. `null` clears; an omitted field is left as is. */
async function resolveDesignations(
  tx: DbClient,
  tenantId: string,
  body: Record<string, unknown>,
  current: InventoryItemRecord | null,
): Promise<DesignationColumns> {
  const result: DesignationColumns = {};
  for (const { field, column } of DESIGNATIONS) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null || value === "") {
      result[column] = null;
      continue;
    }
    const unit = await loadUnitByPublicIdInTx(tx, tenantId, value, field);
    if (unit.status !== "active" && current?.[column] !== unit.id) {
      throw new InventoryError("Archived units cannot be designated. Restore the unit first.", 400, "unit_archived", field);
    }
    result[column] = unit.id;
  }
  return result;
}

/**
 * Resolves `defaultSupplierPublicId`: omitted leaves the default as is, `null`
 * or "" clears it, otherwise it must be this tenant's supplier. An archived
 * supplier is refused unless it is already this item's default.
 */
async function resolveDefaultSupplier(
  tx: DbClient,
  tenantId: string,
  body: Record<string, unknown>,
  current: InventoryItemRecord | null,
): Promise<{ defaultSupplierId?: string | null }> {
  const value = body.defaultSupplierPublicId;
  if (value === undefined) return {};
  if (value === null || value === "") return { defaultSupplierId: null };
  const supplier = await loadSupplierByPublicIdInTx(tx, tenantId, value, "defaultSupplierPublicId");
  if (supplier.status !== "active" && current?.defaultSupplierId !== supplier.id) {
    throw new InventoryError(
      "This supplier is archived. Restore it before choosing it.",
      400,
      "supplier_archived",
      "defaultSupplierPublicId",
    );
  }
  return { defaultSupplierId: supplier.id };
}

/**
 * Resolves `categoryPublicId`: omitted leaves the category as is, `null` or
 * "" clears it, otherwise it must be this tenant's category. An archived
 * category is refused unless it is already this item's category.
 */
async function resolveCategory(
  tx: DbClient,
  tenantId: string,
  body: Record<string, unknown>,
  current: InventoryItemRecord | null,
): Promise<{ categoryId?: string | null }> {
  const value = body.categoryPublicId;
  if (value === undefined) return {};
  if (value === null || value === "") return { categoryId: null };
  const category = await loadCategoryByPublicIdInTx(tx, tenantId, value, "categoryPublicId");
  if (category.status !== "active" && current?.categoryId !== category.id) {
    throw new InventoryError(
      "This category is archived. Restore it before choosing it.",
      400,
      "category_archived",
      "categoryPublicId",
    );
  }
  return { categoryId: category.id };
}

/**
 * Records that would block archiving the item. Nothing does yet: conversions
 * and reference costs are the item's own history, and the default supplier
 * and category are references from the item. QOS-198 adds active recipe
 * lines here and QOS-201 stock balances and movements.
 */
export async function itemDependencies(tx: DbClient, tenantId: string, itemId: string): Promise<Dependency[]> {
  void tx;
  void tenantId;
  void itemId;
  return [];
}

function generateItemPublicId(nameEn: string) {
  return `item_${slugify(nameEn, "item")}_${shortRandomHex(8)}`;
}

function auditItem(
  row: InventoryItemRecord,
  unitsById?: Map<string, InventoryUnitRecord>,
  suppliersById?: Map<string, InventorySupplierRecord>,
  categoriesById?: Map<string, InventoryCategoryRecord>,
) {
  const code = (id: string | null) => (id ? unitsById?.get(id)?.code ?? id : null);
  const supplier = (id: string | null) => {
    if (!id) return null;
    const record = suppliersById?.get(id);
    return record ? record.code ?? record.publicId : id;
  };
  return {
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    kind: row.kind,
    status: row.status,
    storageUnit: code(row.storageUnitId),
    recipeUnit: code(row.recipeUnitId),
    purchaseUnit: code(row.purchaseUnitId),
    defaultSupplier: supplier(row.defaultSupplierId),
    category: row.categoryId ? categoriesById?.get(row.categoryId)?.publicId ?? row.categoryId : null,
    notes: row.notes,
  };
}

export async function createItem(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const nameEn = parseRequiredName(body.nameEn, "nameEn", ITEM_NAME_MAX_LENGTH);
  const nameAr = parseOptionalName(body.nameAr, "nameAr", ITEM_NAME_MAX_LENGTH);
  const kind = parseKind(body.kind);
  const notes = parseOptionalNotes(body.notes);
  return withTenantContext(db, tenantId, async (tx) => {
    const designations = await resolveDesignations(tx, tenantId, body, null);
    const defaultSupplier = await resolveDefaultSupplier(tx, tenantId, body, null);
    const category = await resolveCategory(tx, tenantId, body, null);
    const [row] = await tx
      .insert(inventoryItems)
      .values({
        tenantId,
        publicId: generateItemPublicId(nameEn),
        nameEn,
        nameAr,
        kind,
        storageUnitId: designations.storageUnitId ?? null,
        recipeUnitId: designations.recipeUnitId ?? null,
        purchaseUnitId: designations.purchaseUnitId ?? null,
        defaultSupplierId: defaultSupplier.defaultSupplierId ?? null,
        categoryId: category.categoryId ?? null,
        notes,
        provenance: "operator_entered",
        createdBySubject: actorSubject,
        updatedBySubject: actorSubject,
      })
      .returning();
    const unitsById = new Map((await loadTenantUnitsInTx(tx, tenantId)).map((unit) => [unit.id, unit]));
    const suppliersById = new Map((await loadTenantSuppliersInTx(tx, tenantId)).map((supplier) => [supplier.id, supplier]));
    const categoriesById = new Map((await loadTenantCategoriesInTx(tx, tenantId)).map((entry) => [entry.id, entry]));
    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "inventory.item.create",
      entityType: "inventory_item",
      entityPublicId: row!.publicId,
      entityVersion: row!.version,
      changeSummary: { after: auditItem(row!, unitsById, suppliersById, categoriesById) },
    });
    return loadItemDetailInTx(tx, tenantId, row!.id);
  });
}

export async function updateItem(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  itemPublicId: string,
  input: unknown,
): Promise<ItemDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const nameEn = body.nameEn === undefined ? undefined : parseRequiredName(body.nameEn, "nameEn", ITEM_NAME_MAX_LENGTH);
  const nameAr = body.nameAr === undefined ? undefined : parseOptionalName(body.nameAr, "nameAr", ITEM_NAME_MAX_LENGTH);
  const kind = body.kind === undefined ? undefined : parseKind(body.kind);
  const status = parseStatus(body.status);
  const notes = body.notes === undefined ? undefined : parseOptionalNotes(body.notes);
  return withTenantContext(db, tenantId, async (tx) => {
    const item = await loadItemByPublicIdInTx(tx, tenantId, itemPublicId, "update");
    if (item.version !== expectedVersion) {
      throw versionConflict();
    }
    if (status === "archived" && item.status !== "archived") {
      const dependencies = await itemDependencies(tx, tenantId, item.id);
      if (dependencies.length > 0) {
        throw new InventoryDependencyError("This item is still in use and cannot be archived.", "item_in_use", "status", dependencies);
      }
    }
    const designations = await resolveDesignations(tx, tenantId, body, item);
    const defaultSupplier = await resolveDefaultSupplier(tx, tenantId, body, item);
    const category = await resolveCategory(tx, tenantId, body, item);
    const [updated] = await tx
      .update(inventoryItems)
      .set({
        nameEn: nameEn ?? item.nameEn,
        nameAr: nameAr === undefined ? item.nameAr : nameAr,
        kind: kind ?? item.kind,
        ...designations,
        ...defaultSupplier,
        ...category,
        notes: notes === undefined ? item.notes : notes,
        status: status ?? item.status,
        version: item.version + 1,
        updatedAt: new Date(),
        updatedBySubject: actorSubject,
      })
      .where(and(eq(inventoryItems.id, item.id), eq(inventoryItems.version, expectedVersion)))
      .returning();
    if (!updated) {
      throw versionConflict();
    }
    const unitsById = new Map((await loadTenantUnitsInTx(tx, tenantId)).map((unit) => [unit.id, unit]));
    const suppliersById = new Map((await loadTenantSuppliersInTx(tx, tenantId)).map((supplier) => [supplier.id, supplier]));
    const categoriesById = new Map((await loadTenantCategoriesInTx(tx, tenantId)).map((entry) => [entry.id, entry]));
    const action =
      updated.status !== item.status
        ? updated.status === "archived"
          ? "inventory.item.archive"
          : "inventory.item.restore"
        : "inventory.item.update";
    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action,
      entityType: "inventory_item",
      entityPublicId: updated.publicId,
      entityVersion: updated.version,
      changeSummary: {
        before: auditItem(item, unitsById, suppliersById, categoriesById),
        after: auditItem(updated, unitsById, suppliersById, categoriesById),
      },
    });
    return loadItemDetailInTx(tx, tenantId, updated.id);
  });
}
