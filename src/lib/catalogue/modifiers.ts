import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueModifierGroupTranslations,
  catalogueModifierGroups,
  catalogueModifierOptionTranslations,
  catalogueModifierOptions,
  catalogueProductModifierGroups,
  catalogueProducts,
  tenants,
} from "@/db/schema";
import {
  assertModifierAssignmentPolicyIsValid,
  type EffectiveModifierAssignmentPolicy,
  isSelectionCountMode,
  type ModifierAssignmentOverrides,
  ModifierAssignmentPolicyError,
  resolveModifierAssignmentPolicy,
  toEffectiveModifierGroupRules,
} from "@/lib/catalogue/modifier-assignment-policy";
import {
  assertModifierDefaultsAreFeasible,
  type ModifierGroupRules,
} from "@/lib/catalogue/modifier-selection";
import {
  type AttachModifierGroupInput,
  type CreateModifierGroupInput,
  type CreateModifierOptionInput,
  type DeleteModifierGroupInput,
  type ReorderModifierOptionsInput,
  type ReorderProductModifierGroupsInput,
  type UpdateModifierGroupInput,
  type UpdateModifierOptionInput,
  type UpdateProductModifierGroupPolicyInput,
  validateAttachModifierGroupInput,
  validateCreateModifierGroupInput,
  validateCreateModifierOptionInput,
  validateDeleteModifierGroupInput,
  validateReorderModifierOptionsInput,
  validateReorderProductModifierGroupsInput,
  validateUpdateModifierGroupInput,
  validateUpdateModifierOptionInput,
  validateUpdateProductModifierGroupPolicyInput,
} from "@/lib/catalogue/modifier-validation";
import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import {
  applyCostPolicyOperationInTx,
  loadCurrentCostPoliciesInTx,
  ReferenceCostPolicyError,
  type SellableReferenceCostView,
  toSellableReferenceCostView,
} from "@/lib/catalogue/reference-cost-policies";
import {
  CatalogueProductMutationGuardError,
  CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
  loadCatalogueProductForMutationInTx,
} from "@/lib/catalogue/product-mutation-policy";
import { withTenantContext } from "@/lib/tenant/context";

export const MODIFIER_GROUP_ASSIGNED_CODE = "modifier_group_assigned";

export class CatalogueModifierError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly code?: string;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    code?: string,
  ) {
    super(message);
    this.name = "CatalogueModifierError";
    this.statusCode = statusCode;
    this.field = field;
    this.code = code;
  }
}

export class CatalogueModifierConflictError extends CatalogueModifierError {
  constructor(message: string, field?: string, code?: string) {
    super(message, 409, field, code);
    this.name = "CatalogueModifierConflictError";
  }
}

export type ModifierOptionView = {
  publicId: string;
  sortOrder: number;
  isDefault: boolean;
  allowsQuantity: boolean;
  maxQuantity: number;
  status: "active" | "archived";
  priceMinor: number;
  currency: string;
  /** Whole kcal; null is unknown (hospitality only). */
  nutritionCalories: number | null;
  /** QOS-215 current reference-cost policy and how it resolves (never summed with the base). */
  referenceCost: SellableReferenceCostView;
  translations: Record<ProductLocale, { displayName: string }>;
};

export type ModifierGroupSummaryView = {
  publicId: string;
  internalName: string;
  minSelections: number;
  maxSelections: number;
  version: number;
  status: "active" | "archived";
  optionCount: number;
  affectedProductCount: number;
  translations: Record<ProductLocale, { displayName: string }>;
};

export type ModifierGroupEditorView = ModifierGroupSummaryView & {
  /** Lets the editor apply the hospitality-only calorie gate. */
  businessProfile: "hospitality" | "generic_retail";
  options: ModifierOptionView[];
};

export type ProductModifierGroupAssignmentView = {
  /** catalogue_product_modifier_groups.id, the same value a workbook export writes as qos_product_modifier_id. */
  assignmentId: string;
  assignmentVersion: number;
  assignmentUpdatedAt: string;
  modifierGroupPublicId: string;
  sortOrder: number;
  internalName: string;
  /** The shared group's own bounds, inherited when the override is null. */
  groupMinSelections: number;
  groupMaxSelections: number;
  /** Product-specific overrides; null means inherit. */
  overrides: ModifierAssignmentOverrides;
  /** What this product enforces after combining group, options and overrides. */
  effectivePolicy: EffectiveModifierAssignmentPolicy;
  status: "active" | "archived";
  translations: Record<ProductLocale, { displayName: string }>;
  options: ModifierOptionView[];
};

export type ProductModifierGroupsView = {
  productPublicId: string;
  productVersion: number;
  modifierGroups: ProductModifierGroupAssignmentView[];
};

async function loadTenantBusinessProfile(tx: DbClient, tenantId: string) {
  const [tenant] = await tx
    .select({ businessProfile: tenants.businessProfile })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new CatalogueModifierError("Tenant not found.", 404);
  }

  return tenant.businessProfile;
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "group"
  );
}

function generateModifierGroupPublicId(internalName: string) {
  return `modgrp_${slugify(internalName)}_${randomUUID().slice(0, 8)}`;
}

function generateModifierOptionPublicId(label?: string) {
  const slug = label ? slugify(label) : "option";
  return `modopt_${slug}_${randomUUID().slice(0, 8)}`;
}

function mapCatalogueError(error: unknown): never {
  if (error instanceof CatalogueProductMutationGuardError) {
    if (error.statusCode === 404) {
      throw new CatalogueModifierError(error.message, 404, error.field);
    }
    if (error.code === CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE) {
      throw new CatalogueModifierConflictError(
        error.message,
        error.field,
        error.code,
      );
    }
    throw new CatalogueModifierError(
      error.message,
      error.statusCode,
      error.field,
      error.code,
    );
  }

  if (error instanceof ModifierAssignmentPolicyError) {
    throw new CatalogueModifierError(error.message, 400, error.field, error.code);
  }

  if (error instanceof CatalogueValidationError) {
    throw new CatalogueModifierError(error.message, 400, error.field);
  }

  if (error instanceof ReferenceCostPolicyError) {
    throw new CatalogueModifierError(error.message, error.statusCode, error.field);
  }

  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof CatalogueModifierError) {
    throw error;
  }

  throw error;
}

async function countAffectedProducts(
  tx: DbClient,
  tenantId: string,
  modifierGroupId: string,
) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogueProductModifierGroups)
    .where(
      and(
        eq(catalogueProductModifierGroups.tenantId, tenantId),
        eq(catalogueProductModifierGroups.modifierGroupId, modifierGroupId),
      ),
    );

  return row?.count ?? 0;
}

async function loadGroupByPublicId(
  tx: DbClient,
  tenantId: string,
  groupPublicId: string,
) {
  const [group] = await tx
    .select()
    .from(catalogueModifierGroups)
    .where(
      and(
        eq(catalogueModifierGroups.tenantId, tenantId),
        eq(catalogueModifierGroups.publicId, groupPublicId),
      ),
    )
    .limit(1);

  if (!group) {
    throw new CatalogueModifierError("Modifier group not found.", 404);
  }

  return group;
}

async function bumpModifierGroupVersion(
  tx: DbClient,
  tenantId: string,
  groupId: string,
  expectedVersion: number,
) {
  const [updatedGroup] = await tx
    .update(catalogueModifierGroups)
    .set({
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogueModifierGroups.tenantId, tenantId),
        eq(catalogueModifierGroups.id, groupId),
        eq(catalogueModifierGroups.version, expectedVersion),
      ),
    )
    .returning();

  if (!updatedGroup) {
    throw new CatalogueModifierConflictError(
      "Modifier group was updated elsewhere. Reload and try again.",
      "expectedGroupVersion",
    );
  }

  return updatedGroup;
}

async function loadGroupTranslations(
  tx: DbClient,
  tenantId: string,
  groupIds: string[],
) {
  const map = new Map<string, Record<ProductLocale, { displayName: string }>>();

  for (const groupId of groupIds) {
    map.set(groupId, {
      en: { displayName: "" },
      ar: { displayName: "" },
    });
  }

  if (groupIds.length === 0) {
    return map;
  }

  const rows = await tx
    .select()
    .from(catalogueModifierGroupTranslations)
    .where(
      and(
        eq(catalogueModifierGroupTranslations.tenantId, tenantId),
        inArray(catalogueModifierGroupTranslations.modifierGroupId, groupIds),
      ),
    );

  for (const row of rows) {
    const locale = row.locale as ProductLocale;
    if (locale !== "en" && locale !== "ar") {
      continue;
    }

    const existing = map.get(row.modifierGroupId);
    if (!existing) {
      continue;
    }

    existing[locale] = { displayName: row.displayName };
  }

  return map;
}

async function loadOptionTranslations(
  tx: DbClient,
  tenantId: string,
  optionIds: string[],
) {
  const map = new Map<string, Record<ProductLocale, { displayName: string }>>();

  for (const optionId of optionIds) {
    map.set(optionId, {
      en: { displayName: "" },
      ar: { displayName: "" },
    });
  }

  if (optionIds.length === 0) {
    return map;
  }

  const rows = await tx
    .select()
    .from(catalogueModifierOptionTranslations)
    .where(
      and(
        eq(catalogueModifierOptionTranslations.tenantId, tenantId),
        inArray(catalogueModifierOptionTranslations.modifierOptionId, optionIds),
      ),
    );

  for (const row of rows) {
    const locale = row.locale as ProductLocale;
    if (locale !== "en" && locale !== "ar") {
      continue;
    }

    const existing = map.get(row.modifierOptionId);
    if (!existing) {
      continue;
    }

    existing[locale] = { displayName: row.displayName };
  }

  return map;
}

async function loadModifierOptionsInTx(
  tx: DbClient,
  tenantId: string,
  groupId: string,
): Promise<ModifierOptionView[]> {
  const optionRows = await tx
    .select()
    .from(catalogueModifierOptions)
    .where(
      and(
        eq(catalogueModifierOptions.tenantId, tenantId),
        eq(catalogueModifierOptions.modifierGroupId, groupId),
      ),
    )
    .orderBy(
      asc(catalogueModifierOptions.sortOrder),
      asc(catalogueModifierOptions.publicId),
    );

  const translationsByOptionId = await loadOptionTranslations(
    tx,
    tenantId,
    optionRows.map((row) => row.id),
  );
  const costPolicies = await loadCurrentCostPoliciesInTx(
    tx,
    tenantId,
    "modifier_option",
    optionRows.map((row) => row.id),
  );

  return optionRows.map((row) => ({
    publicId: row.publicId,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    allowsQuantity: row.allowsQuantity,
    maxQuantity: row.maxQuantity,
    status: row.status === "archived" ? "archived" : "active",
    priceMinor: row.priceMinor,
    currency: row.currency.trim(),
    nutritionCalories: row.nutritionCalories,
    referenceCost: toSellableReferenceCostView(costPolicies.get(row.id)),
    translations: translationsByOptionId.get(row.id) ?? {
      en: { displayName: "" },
      ar: { displayName: "" },
    },
  }));
}

function toModifierGroupRules(
  group: {
    publicId: string;
    minSelections: number;
    maxSelections: number;
  },
  options: ModifierOptionView[],
): ModifierGroupRules {
  return {
    publicId: group.publicId,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    options: options.map((option) => ({
      publicId: option.publicId,
      status: option.status,
      isDefault: option.isDefault,
      allowsQuantity: option.allowsQuantity,
      maxQuantity: option.maxQuantity,
      priceMinor: option.priceMinor,
    })),
  };
}

export function assignmentOverridesFromRow(row: {
  minSelections: number | null;
  maxSelections: number | null;
  repeatAllowed: boolean | null;
  selectionCountMode: string | null;
}): ModifierAssignmentOverrides {
  return {
    minSelections: row.minSelections,
    maxSelections: row.maxSelections,
    repeatAllowed: row.repeatAllowed,
    // The column check constraint only admits the two modes or null.
    selectionCountMode: isSelectionCountMode(row.selectionCountMode)
      ? row.selectionCountMode
      : null,
  };
}

/**
 * A change to the shared group (bounds, options, defaults) must stay feasible
 * for every product that overrides its policy, not just for the group's own
 * defaults. Repeat permission is not re-checked here: it can never raise an
 * option cap, so an option change only narrows what repeat_allowed yields.
 */
async function assertGroupAssignmentsRemainFeasible(
  tx: DbClient,
  tenantId: string,
  groupId: string,
  rules: ModifierGroupRules,
) {
  const assignments = await tx
    .select({
      minSelections: catalogueProductModifierGroups.minSelections,
      maxSelections: catalogueProductModifierGroups.maxSelections,
      repeatAllowed: catalogueProductModifierGroups.repeatAllowed,
      selectionCountMode: catalogueProductModifierGroups.selectionCountMode,
      productPublicId: catalogueProducts.publicId,
    })
    .from(catalogueProductModifierGroups)
    .innerJoin(
      catalogueProducts,
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.id, catalogueProductModifierGroups.productId),
      ),
    )
    .where(
      and(
        eq(catalogueProductModifierGroups.tenantId, tenantId),
        eq(catalogueProductModifierGroups.modifierGroupId, groupId),
      ),
    );

  for (const assignment of assignments) {
    const overrides = assignmentOverridesFromRow(assignment);
    if (
      overrides.minSelections == null &&
      overrides.maxSelections == null &&
      overrides.repeatAllowed == null &&
      overrides.selectionCountMode == null
    ) {
      continue;
    }

    try {
      assertModifierAssignmentPolicyIsValid(rules, overrides, {
        checkRepeatConflict: false,
      });
    } catch (error) {
      if (error instanceof ModifierAssignmentPolicyError) {
        throw new ModifierAssignmentPolicyError(
          `Product ${assignment.productPublicId} overrides this group's policy and would become invalid: ${error.message}`,
          error.field ?? "options",
          error.code,
        );
      }
      throw error;
    }
  }
}

/**
 * The selection rules one product enforces for an attached group: pass these
 * to validateModifierGroupSelections so bounds, count mode and repeat caps
 * are the effective ones, never the shared group's raw values.
 */
export function selectionRulesForAssignment(
  assignment: ProductModifierGroupAssignmentView,
): ModifierGroupRules {
  return toEffectiveModifierGroupRules(
    toModifierGroupRules(
      {
        publicId: assignment.modifierGroupPublicId,
        minSelections: assignment.groupMinSelections,
        maxSelections: assignment.groupMaxSelections,
      },
      assignment.options,
    ),
    assignment.overrides,
  );
}

async function loadModifierGroupEditorView(
  tx: DbClient,
  tenantId: string,
  groupId: string,
): Promise<ModifierGroupEditorView> {
  const [group] = await tx
    .select()
    .from(catalogueModifierGroups)
    .where(
      and(
        eq(catalogueModifierGroups.tenantId, tenantId),
        eq(catalogueModifierGroups.id, groupId),
      ),
    )
    .limit(1);

  if (!group) {
    throw new CatalogueModifierError("Modifier group not found.", 404);
  }

  const options = await loadModifierOptionsInTx(tx, tenantId, group.id);
  const translations = (
    await loadGroupTranslations(tx, tenantId, [group.id])
  ).get(group.id) ?? {
    en: { displayName: "" },
    ar: { displayName: "" },
  };

  return {
    publicId: group.publicId,
    internalName: group.internalName,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    version: group.version,
    status: group.status === "archived" ? "archived" : "active",
    optionCount: options.filter((option) => option.status === "active").length,
    affectedProductCount: await countAffectedProducts(tx, tenantId, group.id),
    translations,
    businessProfile: await loadTenantBusinessProfile(tx, tenantId),
    options,
  };
}

async function upsertGroupTranslations(
  tx: DbClient,
  tenantId: string,
  groupId: string,
  translations: Partial<Record<ProductLocale, { displayName: string }>>,
) {
  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    if (!translation) {
      continue;
    }

    const [existing] = await tx
      .select({ id: catalogueModifierGroupTranslations.id })
      .from(catalogueModifierGroupTranslations)
      .where(
        and(
          eq(catalogueModifierGroupTranslations.tenantId, tenantId),
          eq(catalogueModifierGroupTranslations.modifierGroupId, groupId),
          eq(catalogueModifierGroupTranslations.locale, locale),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(catalogueModifierGroupTranslations)
        .set({
          displayName: translation.displayName,
          updatedAt: new Date(),
        })
        .where(eq(catalogueModifierGroupTranslations.id, existing.id));
      continue;
    }

    await tx.insert(catalogueModifierGroupTranslations).values({
      tenantId,
      modifierGroupId: groupId,
      locale,
      displayName: translation.displayName,
    });
  }
}

async function upsertOptionTranslations(
  tx: DbClient,
  tenantId: string,
  optionId: string,
  translations: Partial<Record<ProductLocale, { displayName: string }>>,
) {
  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    if (!translation) {
      continue;
    }

    const [existing] = await tx
      .select({ id: catalogueModifierOptionTranslations.id })
      .from(catalogueModifierOptionTranslations)
      .where(
        and(
          eq(catalogueModifierOptionTranslations.tenantId, tenantId),
          eq(catalogueModifierOptionTranslations.modifierOptionId, optionId),
          eq(catalogueModifierOptionTranslations.locale, locale),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(catalogueModifierOptionTranslations)
        .set({
          displayName: translation.displayName,
          updatedAt: new Date(),
        })
        .where(eq(catalogueModifierOptionTranslations.id, existing.id));
      continue;
    }

    await tx.insert(catalogueModifierOptionTranslations).values({
      tenantId,
      modifierOptionId: optionId,
      locale,
      displayName: translation.displayName,
    });
  }
}

export async function listModifierGroups(
  db: DbClient,
  tenantId: string,
): Promise<ModifierGroupSummaryView[]> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const groups = await tx
        .select()
        .from(catalogueModifierGroups)
        .where(eq(catalogueModifierGroups.tenantId, tenantId))
        .orderBy(asc(catalogueModifierGroups.internalName));

      const translationsByGroupId = await loadGroupTranslations(
        tx,
        tenantId,
        groups.map((group) => group.id),
      );

      const summaries: ModifierGroupSummaryView[] = [];

      for (const group of groups) {
        const options = await loadModifierOptionsInTx(tx, tenantId, group.id);
        summaries.push({
          publicId: group.publicId,
          internalName: group.internalName,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          version: group.version,
          status: group.status === "archived" ? "archived" : "active",
          optionCount: options.filter((option) => option.status === "active")
            .length,
          affectedProductCount: await countAffectedProducts(
            tx,
            tenantId,
            group.id,
          ),
          translations: translationsByGroupId.get(group.id) ?? {
            en: { displayName: "" },
            ar: { displayName: "" },
          },
        });
      }

      return summaries;
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function getModifierGroup(
  db: DbClient,
  tenantId: string,
  groupPublicId: string,
): Promise<ModifierGroupEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const group = await loadGroupByPublicId(tx, tenantId, groupPublicId);
      return loadModifierGroupEditorView(tx, tenantId, group.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function createModifierGroup(
  db: DbClient,
  tenantId: string,
  input: CreateModifierGroupInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ModifierGroupEditorView> {
  try {
    const validated = validateCreateModifierGroupInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      if (validated.publicId) {
        const [existing] = await tx
          .select({ id: catalogueModifierGroups.id })
          .from(catalogueModifierGroups)
          .where(
            and(
              eq(catalogueModifierGroups.tenantId, tenantId),
              eq(catalogueModifierGroups.publicId, validated.publicId),
            ),
          )
          .limit(1);

        if (existing) {
          return loadModifierGroupEditorView(tx, tenantId, existing.id);
        }
      }

      const publicId =
        validated.publicId ?? generateModifierGroupPublicId(validated.internalName);

      const [group] = await tx
        .insert(catalogueModifierGroups)
        .values({
          tenantId,
          publicId,
          internalName: validated.internalName,
          minSelections: validated.minSelections,
          maxSelections: validated.maxSelections,
          provenance: "operator_entered",
        })
        .returning();

      await upsertGroupTranslations(tx, tenantId, group.id, validated.translations);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_group.create",
        entityType: "catalogue_modifier_group",
        entityPublicId: publicId,
        entityVersion: group.version,
        changeSummary: {
          minSelections: validated.minSelections,
          maxSelections: validated.maxSelections,
        },
      });

      return loadModifierGroupEditorView(tx, tenantId, group.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateModifierGroup(
  db: DbClient,
  tenantId: string,
  groupPublicId: string,
  input: UpdateModifierGroupInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ModifierGroupEditorView> {
  try {
    const validated = validateUpdateModifierGroupInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const group = await loadGroupByPublicId(tx, tenantId, groupPublicId);
      const options = await loadModifierOptionsInTx(tx, tenantId, group.id);

      const nextMinSelections = validated.minSelections ?? group.minSelections;
      const nextMaxSelections = validated.maxSelections ?? group.maxSelections;

      const nextRules = toModifierGroupRules(
        {
          publicId: group.publicId,
          minSelections: nextMinSelections,
          maxSelections: nextMaxSelections,
        },
        options,
      );
      assertModifierDefaultsAreFeasible(nextRules);
      await assertGroupAssignmentsRemainFeasible(tx, tenantId, group.id, nextRules);

      const updatedGroup = await bumpModifierGroupVersion(
        tx,
        tenantId,
        group.id,
        validated.expectedVersion,
      );

      await tx
        .update(catalogueModifierGroups)
        .set({
          internalName: validated.internalName ?? group.internalName,
          minSelections: nextMinSelections,
          maxSelections: nextMaxSelections,
          status: validated.status ?? group.status,
          updatedAt: new Date(),
        })
        .where(eq(catalogueModifierGroups.id, group.id));

      await upsertGroupTranslations(tx, tenantId, group.id, validated.translations);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action:
          validated.status === "archived"
            ? "catalogue.modifier_group.archive"
            : "catalogue.modifier_group.update",
        entityType: "catalogue_modifier_group",
        entityPublicId: groupPublicId,
        entityVersion: updatedGroup.version,
        changeSummary: {
          affectedProductCount: await countAffectedProducts(
            tx,
            tenantId,
            group.id,
          ),
          minSelections: nextMinSelections,
          maxSelections: nextMaxSelections,
        },
      });

      return loadModifierGroupEditorView(tx, tenantId, group.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

/**
 * Hard-deletes a modifier group and all of its options. Refused while any
 * product still references the group; nothing outside the group, its options
 * and their translations is touched.
 */
export async function deleteModifierGroup(
  db: DbClient,
  tenantId: string,
  groupPublicId: string,
  input: DeleteModifierGroupInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<{ publicId: string; version: number; optionPublicIds: string[] }> {
  try {
    const { expectedVersion } = validateDeleteModifierGroupInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      // Row lock serialises against a concurrent attach, whose FK check takes
      // a KEY SHARE lock on this row.
      const [group] = await tx
        .select()
        .from(catalogueModifierGroups)
        .where(
          and(
            eq(catalogueModifierGroups.tenantId, tenantId),
            eq(catalogueModifierGroups.publicId, groupPublicId),
          ),
        )
        .limit(1)
        .for("update");

      if (!group) {
        throw new CatalogueModifierError("Modifier group not found.", 404);
      }

      const versionConflict = () =>
        new CatalogueModifierConflictError(
          "Modifier group was updated elsewhere. Reload and try again.",
          "expectedVersion",
        );

      if (group.version !== expectedVersion) {
        throw versionConflict();
      }

      if ((await countAffectedProducts(tx, tenantId, group.id)) > 0) {
        throw new CatalogueModifierConflictError(
          "Detach this modifier group from all products before deleting it.",
          "affectedProductCount",
          MODIFIER_GROUP_ASSIGNED_CODE,
        );
      }

      const options = await tx
        .select({
          id: catalogueModifierOptions.id,
          publicId: catalogueModifierOptions.publicId,
        })
        .from(catalogueModifierOptions)
        .where(
          and(
            eq(catalogueModifierOptions.tenantId, tenantId),
            eq(catalogueModifierOptions.modifierGroupId, group.id),
          ),
        )
        .orderBy(asc(catalogueModifierOptions.sortOrder));
      const optionIds = options.map((option) => option.id);
      const optionPublicIds = options.map((option) => option.publicId);

      if (optionIds.length > 0) {
        await tx
          .delete(catalogueModifierOptionTranslations)
          .where(
            and(
              eq(catalogueModifierOptionTranslations.tenantId, tenantId),
              inArray(
                catalogueModifierOptionTranslations.modifierOptionId,
                optionIds,
              ),
            ),
          );

        await tx
          .delete(catalogueModifierOptions)
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              inArray(catalogueModifierOptions.id, optionIds),
            ),
          );
      }

      await tx
        .delete(catalogueModifierGroupTranslations)
        .where(
          and(
            eq(catalogueModifierGroupTranslations.tenantId, tenantId),
            eq(catalogueModifierGroupTranslations.modifierGroupId, group.id),
          ),
        );

      const [deleted] = await tx
        .delete(catalogueModifierGroups)
        .where(
          and(
            eq(catalogueModifierGroups.tenantId, tenantId),
            eq(catalogueModifierGroups.id, group.id),
            eq(catalogueModifierGroups.version, expectedVersion),
          ),
        )
        .returning({ id: catalogueModifierGroups.id });

      if (!deleted) {
        throw versionConflict();
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_group.delete",
        entityType: "catalogue_modifier_group",
        entityPublicId: groupPublicId,
        entityVersion: group.version,
        changeSummary: {
          internalName: group.internalName,
          status: group.status,
          optionPublicIds,
          optionCount: optionPublicIds.length,
          affectedProductCount: 0,
        },
      });

      return { publicId: group.publicId, version: group.version, optionPublicIds };
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function createModifierOption(
  db: DbClient,
  tenantId: string,
  groupPublicId: string,
  input: CreateModifierOptionInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ModifierGroupEditorView> {
  try {
    if (membership.role !== "administrator") {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change modifier prices.",
      );
    }
    if (validated.costPolicy?.operation === "clear") {
      throw new CatalogueModifierError(
        "A new option has no cost policy to clear.",
        400,
        "costPolicy.operation",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
      const validated = validateCreateModifierOptionInput(
        input,
        await loadTenantBusinessProfile(tx, tenantId),
      );
      const group = await loadGroupByPublicId(tx, tenantId, groupPublicId);

      if (validated.publicId) {
        const [existing] = await tx
          .select({ id: catalogueModifierOptions.id })
          .from(catalogueModifierOptions)
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              eq(catalogueModifierOptions.publicId, validated.publicId),
            ),
          )
          .limit(1);

        if (existing) {
          return loadModifierGroupEditorView(tx, tenantId, group.id);
        }
      }

      const existingOptions = await loadModifierOptionsInTx(tx, tenantId, group.id);
      const nextSortOrder =
        validated.sortOrder ??
        (existingOptions.length === 0
          ? 0
          : Math.max(...existingOptions.map((option) => option.sortOrder)) + 1);

      const labelSeed =
        validated.translations.en?.displayName ||
        validated.translations.ar?.displayName;
      const publicId =
        validated.publicId ?? generateModifierOptionPublicId(labelSeed);

      const updatedGroup = await bumpModifierGroupVersion(
        tx,
        tenantId,
        group.id,
        validated.expectedGroupVersion,
      );

      if (validated.isDefault) {
        await tx
          .update(catalogueModifierOptions)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              eq(catalogueModifierOptions.modifierGroupId, group.id),
            ),
          );
      }

      const [option] = await tx
        .insert(catalogueModifierOptions)
        .values({
          tenantId,
          modifierGroupId: group.id,
          publicId,
          sortOrder: nextSortOrder,
          isDefault: validated.isDefault,
          allowsQuantity: validated.allowsQuantity,
          maxQuantity: validated.maxQuantity,
          priceMinor: validated.priceMinor,
          currency: validated.currency,
          nutritionCalories: validated.nutritionCalories,
        })
        .returning();

      await upsertOptionTranslations(tx, tenantId, option.id, {
        en: { displayName: validated.translations.en?.displayName ?? "" },
        ar: { displayName: validated.translations.ar?.displayName ?? "" },
      });

      if (validated.costPolicy) {
        await applyCostPolicyOperationInTx(tx, {
          tenantId,
          kind: "modifier_option",
          sellableId: option.id,
          sellablePublicId: publicId,
          operation: validated.costPolicy,
          membership,
          actorSubject: staffSubject,
          provenance: "operator_entered",
          entityVersion: updatedGroup.version,
        });
      }

      const options = await loadModifierOptionsInTx(tx, tenantId, group.id);
      const nextRules = toModifierGroupRules(
        {
          publicId: group.publicId,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
        },
        options,
      );
      assertModifierDefaultsAreFeasible(nextRules);
      await assertGroupAssignmentsRemainFeasible(tx, tenantId, group.id, nextRules);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_option.create",
        entityType: "catalogue_modifier_option",
        entityPublicId: publicId,
        entityVersion: updatedGroup.version,
        changeSummary: {
          modifierGroupPublicId: groupPublicId,
          priceMinor: validated.priceMinor,
          nutritionCalories: validated.nutritionCalories,
        },
      });

      return loadModifierGroupEditorView(tx, tenantId, group.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateModifierOption(
  db: DbClient,
  tenantId: string,
  groupPublicId: string,
  optionPublicId: string,
  input: UpdateModifierOptionInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ModifierGroupEditorView> {
  try {
    if (input.priceMinor != null && membership.role !== "administrator") {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change modifier prices.",
      );
    }
    if (validated.costPolicy !== undefined && membership.role !== "administrator") {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change modifier reference costs.",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
      const validated = validateUpdateModifierOptionInput(
        input,
        await loadTenantBusinessProfile(tx, tenantId),
      );
      const group = await loadGroupByPublicId(tx, tenantId, groupPublicId);

      const [option] = await tx
        .select()
        .from(catalogueModifierOptions)
        .where(
          and(
            eq(catalogueModifierOptions.tenantId, tenantId),
            eq(catalogueModifierOptions.modifierGroupId, group.id),
            eq(catalogueModifierOptions.publicId, optionPublicId),
          ),
        )
        .limit(1);

      if (!option) {
        throw new CatalogueModifierError("Modifier option not found.", 404);
      }

      const updatedGroup = await bumpModifierGroupVersion(
        tx,
        tenantId,
        group.id,
        validated.expectedGroupVersion,
      );

      if (validated.isDefault) {
        await tx
          .update(catalogueModifierOptions)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              eq(catalogueModifierOptions.modifierGroupId, group.id),
            ),
          );
      }

      await tx
        .update(catalogueModifierOptions)
        .set({
          sortOrder: validated.sortOrder ?? option.sortOrder,
          isDefault: validated.isDefault ?? option.isDefault,
          allowsQuantity: validated.allowsQuantity ?? option.allowsQuantity,
          maxQuantity: validated.maxQuantity ?? option.maxQuantity,
          status: validated.status ?? option.status,
          priceMinor: validated.priceMinor ?? option.priceMinor,
          nutritionCalories:
            validated.nutritionCalories === undefined
              ? option.nutritionCalories
              : validated.nutritionCalories,
          updatedAt: new Date(),
        })
        .where(eq(catalogueModifierOptions.id, option.id));

      await upsertOptionTranslations(tx, tenantId, option.id, validated.translations);

      // Omitting costPolicy leaves the current policy exactly as it is.
      if (validated.costPolicy) {
        await applyCostPolicyOperationInTx(tx, {
          tenantId,
          kind: "modifier_option",
          sellableId: option.id,
          sellablePublicId: option.publicId,
          operation: validated.costPolicy,
          membership,
          actorSubject: staffSubject,
          provenance: "operator_entered",
          entityVersion: updatedGroup.version,
        });
      }

      const options = await loadModifierOptionsInTx(tx, tenantId, group.id);
      const nextRules = toModifierGroupRules(
        {
          publicId: group.publicId,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
        },
        options,
      );
      assertModifierDefaultsAreFeasible(nextRules);
      await assertGroupAssignmentsRemainFeasible(tx, tenantId, group.id, nextRules);

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action:
          validated.status === "archived"
            ? "catalogue.modifier_option.archive"
            : "catalogue.modifier_option.update",
        entityType: "catalogue_modifier_option",
        entityPublicId: optionPublicId,
        entityVersion: updatedGroup.version,
        changeSummary: {
          modifierGroupPublicId: groupPublicId,
          status: validated.status ?? option.status,
          ...(validated.nutritionCalories !== undefined &&
          validated.nutritionCalories !== option.nutritionCalories
            ? {
                nutritionCalories: {
                  before: option.nutritionCalories,
                  after: validated.nutritionCalories,
                },
              }
            : {}),
        },
      });

      return loadModifierGroupEditorView(tx, tenantId, group.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function reorderModifierOptions(
  db: DbClient,
  tenantId: string,
  groupPublicId: string,
  input: ReorderModifierOptionsInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ModifierGroupEditorView> {
  try {
    const validated = validateReorderModifierOptionsInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const group = await loadGroupByPublicId(tx, tenantId, groupPublicId);
      const options = await tx
        .select({
          publicId: catalogueModifierOptions.publicId,
          status: catalogueModifierOptions.status,
        })
        .from(catalogueModifierOptions)
        .where(
          and(
            eq(catalogueModifierOptions.tenantId, tenantId),
            eq(catalogueModifierOptions.modifierGroupId, group.id),
          ),
        );

      const activePublicIds = options
        .filter((option) => option.status !== "archived")
        .map((option) => option.publicId)
        .sort();

      const requestedActiveIds = [...validated.orderedPublicIds].sort();

      if (activePublicIds.join("|") !== requestedActiveIds.join("|")) {
        throw new CatalogueModifierError(
          "orderedPublicIds must include every active option exactly once.",
          400,
          "orderedPublicIds",
        );
      }

      const updatedGroup = await bumpModifierGroupVersion(
        tx,
        tenantId,
        group.id,
        validated.expectedGroupVersion,
      );

      for (const [index, publicId] of validated.orderedPublicIds.entries()) {
        await tx
          .update(catalogueModifierOptions)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              eq(catalogueModifierOptions.modifierGroupId, group.id),
              eq(catalogueModifierOptions.publicId, publicId),
            ),
          );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_option.reorder",
        entityType: "catalogue_modifier_group",
        entityPublicId: groupPublicId,
        entityVersion: updatedGroup.version,
        changeSummary: {
          orderedPublicIds: validated.orderedPublicIds,
        },
      });

      return loadModifierGroupEditorView(tx, tenantId, group.id);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

async function loadProductModifierGroupsInTx(
  tx: DbClient,
  tenantId: string,
  product: typeof catalogueProducts.$inferSelect,
): Promise<ProductModifierGroupsView> {
  const assignments = await tx
        .select({
          assignmentId: catalogueProductModifierGroups.id,
          assignmentVersion: catalogueProductModifierGroups.version,
          assignmentUpdatedAt: catalogueProductModifierGroups.updatedAt,
          overrideMinSelections: catalogueProductModifierGroups.minSelections,
          overrideMaxSelections: catalogueProductModifierGroups.maxSelections,
          repeatAllowed: catalogueProductModifierGroups.repeatAllowed,
          selectionCountMode: catalogueProductModifierGroups.selectionCountMode,
          sortOrder: catalogueProductModifierGroups.sortOrder,
          groupId: catalogueModifierGroups.id,
          groupPublicId: catalogueModifierGroups.publicId,
          internalName: catalogueModifierGroups.internalName,
          minSelections: catalogueModifierGroups.minSelections,
          maxSelections: catalogueModifierGroups.maxSelections,
          status: catalogueModifierGroups.status,
        })
        .from(catalogueProductModifierGroups)
        .innerJoin(
          catalogueModifierGroups,
          and(
            eq(catalogueModifierGroups.tenantId, tenantId),
            eq(
              catalogueModifierGroups.id,
              catalogueProductModifierGroups.modifierGroupId,
            ),
          ),
        )
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.productId, product.id),
          ),
        )
        .orderBy(asc(catalogueProductModifierGroups.sortOrder));

      const groupTranslations = await loadGroupTranslations(
        tx,
        tenantId,
        assignments.map((assignment) => assignment.groupId),
      );

      const modifierGroups: ProductModifierGroupAssignmentView[] = [];

      for (const assignment of assignments) {
        const options = await loadModifierOptionsInTx(
          tx,
          tenantId,
          assignment.groupId,
        );

        const overrides = assignmentOverridesFromRow({
          minSelections: assignment.overrideMinSelections,
          maxSelections: assignment.overrideMaxSelections,
          repeatAllowed: assignment.repeatAllowed,
          selectionCountMode: assignment.selectionCountMode,
        });

        modifierGroups.push({
          assignmentId: assignment.assignmentId,
          assignmentVersion: assignment.assignmentVersion,
          assignmentUpdatedAt: assignment.assignmentUpdatedAt.toISOString(),
          modifierGroupPublicId: assignment.groupPublicId,
          sortOrder: assignment.sortOrder,
          internalName: assignment.internalName,
          groupMinSelections: assignment.minSelections,
          groupMaxSelections: assignment.maxSelections,
          overrides,
          effectivePolicy: resolveModifierAssignmentPolicy(
            toModifierGroupRules(
              {
                publicId: assignment.groupPublicId,
                minSelections: assignment.minSelections,
                maxSelections: assignment.maxSelections,
              },
              options,
            ),
            overrides,
          ),
          status: assignment.status === "archived" ? "archived" : "active",
          translations: groupTranslations.get(assignment.groupId) ?? {
            en: { displayName: "" },
            ar: { displayName: "" },
          },
          options,
        });
      }

  return {
    productPublicId: product.publicId,
    productVersion: product.version,
    modifierGroups,
  };
}

export async function listProductModifierGroups(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
): Promise<ProductModifierGroupsView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const [product] = await tx
        .select()
        .from(catalogueProducts)
        .where(
          and(
            eq(catalogueProducts.tenantId, tenantId),
            eq(catalogueProducts.publicId, productPublicId),
          ),
        )
        .limit(1);

      if (!product) {
        throw new CatalogueModifierError("Product not found.", 404);
      }

      return loadProductModifierGroupsInTx(tx, tenantId, product);
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

async function bumpProductVersion(
  tx: DbClient,
  tenantId: string,
  productId: string,
  expectedVersion: number,
) {
  const [updatedProduct] = await tx
    .update(catalogueProducts)
    .set({
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.id, productId),
        eq(catalogueProducts.version, expectedVersion),
      ),
    )
    .returning();

  if (!updatedProduct) {
    throw new CatalogueModifierConflictError(
      "Product was updated elsewhere. Reload and try again.",
      "expectedProductVersion",
    );
  }

  return updatedProduct;
}

export async function attachModifierGroupToProduct(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  input: AttachModifierGroupInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ProductModifierGroupsView> {
  try {
    const validated = validateAttachModifierGroupInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadCatalogueProductForMutationInTx(
        tx,
        tenantId,
        productPublicId,
      );

      const group = await loadGroupByPublicId(
        tx,
        tenantId,
        validated.modifierGroupPublicId,
      );

      if (group.status === "archived") {
        throw new CatalogueModifierError(
          "Archived modifier groups cannot be attached to products.",
          400,
          "modifierGroupPublicId",
        );
      }

      const [existingAssignment] = await tx
        .select({ id: catalogueProductModifierGroups.id })
        .from(catalogueProductModifierGroups)
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.productId, product.id),
            eq(catalogueProductModifierGroups.modifierGroupId, group.id),
          ),
        )
        .limit(1);

      if (existingAssignment) {
        return loadProductModifierGroupsInTx(tx, tenantId, product);
      }

      const assignments = await tx
        .select({ sortOrder: catalogueProductModifierGroups.sortOrder })
        .from(catalogueProductModifierGroups)
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.productId, product.id),
          ),
        );

      const nextSortOrder =
        validated.sortOrder ??
        (assignments.length === 0
          ? 0
          : Math.max(...assignments.map((row) => row.sortOrder)) + 1);

      await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        validated.expectedProductVersion,
      );

      await tx.insert(catalogueProductModifierGroups).values({
        tenantId,
        productId: product.id,
        modifierGroupId: group.id,
        sortOrder: nextSortOrder,
      });

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_group.attach",
        entityType: "catalogue_product",
        entityPublicId: productPublicId,
        changeSummary: {
          modifierGroupPublicId: validated.modifierGroupPublicId,
        },
      });

      const [reloadedProduct] = await tx
        .select()
        .from(catalogueProducts)
        .where(eq(catalogueProducts.id, product.id))
        .limit(1);

      return loadProductModifierGroupsInTx(
        tx,
        tenantId,
        reloadedProduct ?? product,
      );
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function detachModifierGroupFromProduct(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  modifierGroupPublicId: string,
  expectedProductVersion: number,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ProductModifierGroupsView> {
  try {
    if (!Number.isInteger(expectedProductVersion) || expectedProductVersion < 1) {
      throw new CatalogueModifierError(
        "expectedProductVersion must be a positive integer.",
        400,
        "expectedProductVersion",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadCatalogueProductForMutationInTx(
        tx,
        tenantId,
        productPublicId,
      );

      const group = await loadGroupByPublicId(tx, tenantId, modifierGroupPublicId);

      await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        expectedProductVersion,
      );

      await tx
        .delete(catalogueProductModifierGroups)
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.productId, product.id),
            eq(catalogueProductModifierGroups.modifierGroupId, group.id),
          ),
        );

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_group.detach",
        entityType: "catalogue_product",
        entityPublicId: productPublicId,
        changeSummary: {
          modifierGroupPublicId,
        },
      });

      const [reloadedProduct] = await tx
        .select()
        .from(catalogueProducts)
        .where(eq(catalogueProducts.id, product.id))
        .limit(1);

      return loadProductModifierGroupsInTx(
        tx,
        tenantId,
        reloadedProduct ?? product,
      );
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function reorderProductModifierGroups(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  input: ReorderProductModifierGroupsInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ProductModifierGroupsView> {
  try {
    const validated = validateReorderProductModifierGroupsInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadCatalogueProductForMutationInTx(
        tx,
        tenantId,
        productPublicId,
      );

      const assignments = await tx
        .select({
          groupPublicId: catalogueModifierGroups.publicId,
        })
        .from(catalogueProductModifierGroups)
        .innerJoin(
          catalogueModifierGroups,
          and(
            eq(catalogueModifierGroups.tenantId, tenantId),
            eq(
              catalogueModifierGroups.id,
              catalogueProductModifierGroups.modifierGroupId,
            ),
          ),
        )
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.productId, product.id),
          ),
        );

      const assignedPublicIds = assignments
        .map((assignment) => assignment.groupPublicId)
        .sort();

      const requestedIds = [...validated.orderedPublicIds].sort();

      if (assignedPublicIds.join("|") !== requestedIds.join("|")) {
        throw new CatalogueModifierError(
          "orderedPublicIds must include every attached modifier group exactly once.",
          400,
          "orderedPublicIds",
        );
      }

      await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        validated.expectedProductVersion,
      );

      for (const [index, groupPublicId] of validated.orderedPublicIds.entries()) {
        const group = await loadGroupByPublicId(tx, tenantId, groupPublicId);

        await tx
          .update(catalogueProductModifierGroups)
          .set({ sortOrder: index })
          .where(
            and(
              eq(catalogueProductModifierGroups.tenantId, tenantId),
              eq(catalogueProductModifierGroups.productId, product.id),
              eq(catalogueProductModifierGroups.modifierGroupId, group.id),
            ),
          );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_group.reorder_on_product",
        entityType: "catalogue_product",
        entityPublicId: productPublicId,
        changeSummary: {
          orderedPublicIds: validated.orderedPublicIds,
        },
      });

      const [reloadedProduct] = await tx
        .select()
        .from(catalogueProducts)
        .where(eq(catalogueProducts.id, product.id))
        .limit(1);

      return loadProductModifierGroupsInTx(
        tx,
        tenantId,
        reloadedProduct ?? product,
      );
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateProductModifierGroupPolicy(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  modifierGroupPublicId: string,
  input: UpdateProductModifierGroupPolicyInput,
  staffSubject: string,
  membership: ActiveStaffMembership,
): Promise<ProductModifierGroupsView> {
  try {
    const validated = validateUpdateProductModifierGroupPolicyInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadCatalogueProductForMutationInTx(
        tx,
        tenantId,
        productPublicId,
      );

      const group = await loadGroupByPublicId(tx, tenantId, modifierGroupPublicId);

      const [assignment] = await tx
        .select()
        .from(catalogueProductModifierGroups)
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.productId, product.id),
            eq(catalogueProductModifierGroups.modifierGroupId, group.id),
          ),
        )
        .limit(1);

      if (!assignment) {
        throw new CatalogueModifierError(
          "Modifier group is not attached to this product.",
          404,
        );
      }

      const before = assignmentOverridesFromRow(assignment);
      const next: ModifierAssignmentOverrides = { ...before, ...validated.changes };

      const options = await loadModifierOptionsInTx(tx, tenantId, group.id);
      assertModifierAssignmentPolicyIsValid(
        toModifierGroupRules(group, options),
        next,
      );

      const [updatedAssignment] = await tx
        .update(catalogueProductModifierGroups)
        .set({
          minSelections: next.minSelections,
          maxSelections: next.maxSelections,
          repeatAllowed: next.repeatAllowed,
          selectionCountMode: next.selectionCountMode,
          version: validated.expectedAssignmentVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            eq(catalogueProductModifierGroups.id, assignment.id),
            eq(
              catalogueProductModifierGroups.version,
              validated.expectedAssignmentVersion,
            ),
          ),
        )
        .returning();

      if (!updatedAssignment) {
        throw new CatalogueModifierConflictError(
          "Modifier group policy for this product was updated elsewhere. Reload and try again.",
          "expectedAssignmentVersion",
        );
      }

      await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        validated.expectedProductVersion,
      );

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.modifier_group.assignment_update",
        entityType: "catalogue_product",
        entityPublicId: productPublicId,
        entityVersion: updatedAssignment.version,
        changeSummary: {
          modifierGroupPublicId,
          assignmentId: assignment.id,
          before,
          after: next,
        },
      });

      const [reloadedProduct] = await tx
        .select()
        .from(catalogueProducts)
        .where(eq(catalogueProducts.id, product.id))
        .limit(1);

      return loadProductModifierGroupsInTx(
        tx,
        tenantId,
        reloadedProduct ?? product,
      );
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}
