import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type RecipeVersionLineRecord,
  type RecipeVersionModifierEffectRecord,
  catalogueModifierGroups,
  catalogueModifierOptions,
  catalogueModifierOptionTranslations,
  catalogueProductModifierGroups,
  catalogueVariants,
  inventoryItemConversions,
  inventoryItems,
  inventoryUnits,
  recipeSellableLinks,
  recipeVersionLines,
  recipeVersionModifierEffects,
} from "@/db/schema";
import { buildItemGraph, findPath } from "@/lib/inventory/conversion-graph";
import { InventoryDetailError, InventoryError } from "@/lib/inventory/errors";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import {
  asBody,
  loadTenantUnitsInTx,
  parseExpectedVersion,
  requireInventoryAdministrator,
  shortRandomHex,
  tenantToday,
} from "@/lib/inventory/shared";
import { isLiveOn, isOpenOn } from "@/lib/recipes/dates";
import { loadRecipeDetailInTx } from "@/lib/recipes/recipes";
import { loadReferencedItemInTx, loadReferencedUnitInTx, parseOptionalLabel, parseUnitQuantity } from "@/lib/recipes/shared";
import { toGraphRule, toGraphUnit, type RecipeDetailView } from "@/lib/recipes/views";
import { auditVersionInTx, bumpVersionInTx, lockDraftInTx } from "@/lib/recipes/versions";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-199 modifier effects persistence. An effect belongs to one recipe
   version and says what one selected option adds (add), removes (remove a
   base line) or replaces (replace a base line with an item and quantity).
   Effects follow the lines' lifecycle: only a draft changes them, as a
   whole ordered list (rows kept by public id, left-out rows marked removed,
   never deleted). Save-time rules: sellable recipes only; an active option
   whose group is attached to a product with a variant linked to this recipe
   (reviewed applicability, never a name match); a target line active on the
   draft; an active item and a unit convertible to its storage unit today;
   one remove or replace per option per line and one add per option per
   item. Every write is administrator-only, locks the family and version,
   and records one audit event in the same transaction. Option prices and
   selection rules are read, never written. Nothing posts stock. */

export const MAX_EFFECTS = 100;
export const EFFECT_NOTES_MAX_LENGTH = 200;
export const EFFECT_TYPES = ["add", "remove", "replace"] as const;

export const generateEffectPublicId = () => `eff_${shortRandomHex(16)}`;

export async function activeEffectsInTx(tx: DbClient, tenantId: string, versionId: string) {
  return (
    await tx
      .select()
      .from(recipeVersionModifierEffects)
      .where(
        and(
          eq(recipeVersionModifierEffects.tenantId, tenantId),
          eq(recipeVersionModifierEffects.recipeVersionId, versionId),
          eq(recipeVersionModifierEffects.status, "active"),
        ),
      )
  ).sort((a, b) => a.position - b.position);
}

/** Public-id summaries for the audit trail and the approval snapshot. */
export async function effectSummariesInTx(tx: DbClient, tenantId: string, effects: RecipeVersionModifierEffectRecord[]) {
  if (effects.length === 0) return [];
  const options = await tx
    .select({
      id: catalogueModifierOptions.id,
      publicId: catalogueModifierOptions.publicId,
      groupPublicId: catalogueModifierGroups.publicId,
    })
    .from(catalogueModifierOptions)
    .innerJoin(
      catalogueModifierGroups,
      and(eq(catalogueModifierGroups.tenantId, catalogueModifierOptions.tenantId), eq(catalogueModifierGroups.id, catalogueModifierOptions.modifierGroupId)),
    )
    .where(and(eq(catalogueModifierOptions.tenantId, tenantId), inArray(catalogueModifierOptions.id, effects.map((effect) => effect.modifierOptionId))));
  const names = await tx
    .select({
      optionId: catalogueModifierOptionTranslations.modifierOptionId,
      locale: catalogueModifierOptionTranslations.locale,
      displayName: catalogueModifierOptionTranslations.displayName,
    })
    .from(catalogueModifierOptionTranslations)
    .where(
      and(
        eq(catalogueModifierOptionTranslations.tenantId, tenantId),
        inArray(catalogueModifierOptionTranslations.modifierOptionId, effects.map((effect) => effect.modifierOptionId)),
      ),
    );
  const optionName = (optionId: string, locale: "en" | "ar") =>
    names.find((row) => row.optionId === optionId && row.locale === locale)?.displayName.trim() || null;
  const itemIds = effects.map((effect) => effect.itemId).filter((id): id is string => id !== null);
  const items = itemIds.length
    ? await tx
        .select({ id: inventoryItems.id, publicId: inventoryItems.publicId, nameEn: inventoryItems.nameEn })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, itemIds)))
    : [];
  const lineIds = effects.map((effect) => effect.targetLineId).filter((id): id is string => id !== null);
  const lines = lineIds.length
    ? await tx
        .select({ id: recipeVersionLines.id, publicId: recipeVersionLines.publicId })
        .from(recipeVersionLines)
        .where(and(eq(recipeVersionLines.tenantId, tenantId), inArray(recipeVersionLines.id, lineIds)))
    : [];
  const units = new Map((await loadTenantUnitsInTx(tx, tenantId)).map((unit) => [unit.id, unit]));
  return effects.map((effect) => {
    const option = options.find((row) => row.id === effect.modifierOptionId);
    const item = effect.itemId ? items.find((row) => row.id === effect.itemId) : undefined;
    const unit = effect.unitId ? units.get(effect.unitId) : undefined;
    return {
      effectPublicId: effect.publicId,
      position: effect.position,
      effectType: effect.effectType,
      optionPublicId: option?.publicId ?? null,
      optionNameEn: optionName(effect.modifierOptionId, "en"),
      optionNameAr: optionName(effect.modifierOptionId, "ar"),
      groupPublicId: option?.groupPublicId ?? null,
      targetLinePublicId: effect.targetLineId ? lines.find((row) => row.id === effect.targetLineId)?.publicId ?? null : null,
      itemPublicId: item?.publicId ?? null,
      itemNameEn: item?.nameEn ?? null,
      quantity: effect.quantityMicros === null ? null : microsToDecimalString(effect.quantityMicros),
      quantityMicros: effect.quantityMicros === null ? null : effect.quantityMicros.toString(),
      unit: unit?.code ?? null,
      unitPublicId: unit?.publicId ?? null,
      notes: effect.notes,
    };
  });
}

/**
 * Copies the source version's active effects into a new draft, pointing each
 * remove or replace at the draft's copy of the same line. Lines are copied
 * first and keep one active line per item, so the copy is found by item, never
 * by a name. Returns the number of effects copied.
 */
export async function copyEffectsToDraftInTx(
  tx: DbClient,
  tenantId: string,
  actorSubject: string,
  sourceLines: RecipeVersionLineRecord[],
  draftLines: RecipeVersionLineRecord[],
  sourceVersionId: string,
  draftVersionId: string,
): Promise<number> {
  const effects = await activeEffectsInTx(tx, tenantId, sourceVersionId);
  if (effects.length === 0) return 0;
  const draftLineFor = (sourceLineId: string) => {
    const source = sourceLines.find((line) => line.id === sourceLineId);
    const copy = source ? draftLines.find((line) => line.itemId === source.itemId) : undefined;
    if (!copy) {
      throw new Error(`Effect target line ${sourceLineId} was not copied to the draft.`);
    }
    return copy.id;
  };
  await tx.insert(recipeVersionModifierEffects).values(
    effects.map((effect, index) => ({
      tenantId,
      publicId: generateEffectPublicId(),
      recipeVersionId: draftVersionId,
      modifierOptionId: effect.modifierOptionId,
      effectType: effect.effectType,
      targetLineId: effect.targetLineId ? draftLineFor(effect.targetLineId) : null,
      itemId: effect.itemId,
      unitId: effect.unitId,
      quantityMicros: effect.quantityMicros,
      notes: effect.notes,
      position: index,
      createdBySubject: actorSubject,
      updatedBySubject: actorSubject,
    })),
  );
  return effects.length;
}

/**
 * A base line an active effect removes or replaces cannot be dropped from the
 * draft or switched to another item: the effect would silently point at
 * something else. Refused with the options involved.
 */
export async function assertTargetedLinesKeptInTx(
  tx: DbClient,
  tenantId: string,
  versionId: string,
  existing: RecipeVersionLineRecord[],
  kept: Array<{ linePublicId: string | null; itemId: string }>,
) {
  const effects = (await activeEffectsInTx(tx, tenantId, versionId)).filter((effect) => effect.targetLineId !== null);
  if (effects.length === 0) return;
  const broken = existing.filter((line) => {
    if (!effects.some((effect) => effect.targetLineId === line.id)) return false;
    const next = kept.find((entry) => entry.linePublicId === line.publicId);
    return !next || next.itemId !== line.itemId;
  });
  if (broken.length === 0) return;
  const optionIds = [...new Set(effects.filter((effect) => broken.some((line) => line.id === effect.targetLineId)).map((effect) => effect.modifierOptionId))];
  const options = await tx
    .select({ publicId: catalogueModifierOptions.publicId })
    .from(catalogueModifierOptions)
    .where(and(eq(catalogueModifierOptions.tenantId, tenantId), inArray(catalogueModifierOptions.id, optionIds)));
  throw new InventoryDetailError(
    "A modifier effect removes or replaces this line. Change or remove the effect first.",
    "line_targeted_by_effect",
    "lines",
    { linePublicIds: broken.map((line) => line.publicId), optionPublicIds: options.map((option) => option.publicId).sort() },
  );
}

/** Approval refuses effects whose item or unit has been archived since they were saved. */
export async function assertEffectsApprovableInTx(tx: DbClient, tenantId: string, versionId: string) {
  const effects = await activeEffectsInTx(tx, tenantId, versionId);
  const itemIds = effects.map((effect) => effect.itemId).filter((id): id is string => id !== null);
  if (itemIds.length > 0) {
    const items = await tx
      .select({ status: inventoryItems.status })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, itemIds)))
      .for("share");
    if (items.some((item) => item.status !== "active")) {
      throw new InventoryError("A modifier effect uses an archived item. Replace or restore it before approving.", 400, "item_archived", "effects");
    }
  }
  const unitIds = effects.map((effect) => effect.unitId).filter((id): id is string => id !== null);
  if (unitIds.length > 0) {
    const units = await tx
      .select({ status: inventoryUnits.status })
      .from(inventoryUnits)
      .where(and(eq(inventoryUnits.tenantId, tenantId), inArray(inventoryUnits.id, unitIds)))
      .for("share");
    if (units.some((unit) => unit.status !== "active")) {
      throw new InventoryError("A modifier effect uses an archived unit. Replace or restore it before approving.", 400, "unit_archived", "effects");
    }
  }
  return effects;
}

/** Option ids an effect on this recipe may use: groups attached to products whose variants have an open link to it. */
async function applicableOptionIdsInTx(tx: DbClient, tenantId: string, recipeId: string, today: string) {
  const links = (
    await tx
      .select({ variantId: recipeSellableLinks.variantId, effectiveTo: recipeSellableLinks.effectiveTo })
      .from(recipeSellableLinks)
      .where(and(eq(recipeSellableLinks.tenantId, tenantId), eq(recipeSellableLinks.recipeId, recipeId)))
  ).filter((link) => isOpenOn(link.effectiveTo, today));
  if (links.length === 0) return new Set<string>();
  const variants = await tx
    .select({ productId: catalogueVariants.productId })
    .from(catalogueVariants)
    .where(and(eq(catalogueVariants.tenantId, tenantId), inArray(catalogueVariants.id, links.map((link) => link.variantId))));
  const groups = await tx
    .select({ groupId: catalogueProductModifierGroups.modifierGroupId })
    .from(catalogueProductModifierGroups)
    .where(
      and(
        eq(catalogueProductModifierGroups.tenantId, tenantId),
        inArray(catalogueProductModifierGroups.productId, [...new Set(variants.map((variant) => variant.productId))]),
      ),
    );
  if (groups.length === 0) return new Set<string>();
  const options = await tx
    .select({ id: catalogueModifierOptions.id })
    .from(catalogueModifierOptions)
    .where(
      and(
        eq(catalogueModifierOptions.tenantId, tenantId),
        inArray(catalogueModifierOptions.modifierGroupId, [...new Set(groups.map((group) => group.groupId))]),
      ),
    );
  return new Set(options.map((option) => option.id));
}

async function loadOptionByPublicIdInTx(tx: DbClient, tenantId: string, publicId: unknown, field: string) {
  if (publicId == null || publicId === "") {
    throw new InventoryError("Choose a modifier option for every effect.", 400, "effect_option_required", field);
  }
  if (typeof publicId !== "string") {
    throw new InventoryError("Modifier option not found.", 404, "option_not_found", field);
  }
  const [row] = await tx
    .select({
      id: catalogueModifierOptions.id,
      publicId: catalogueModifierOptions.publicId,
      status: catalogueModifierOptions.status,
      groupStatus: catalogueModifierGroups.status,
    })
    .from(catalogueModifierOptions)
    .innerJoin(
      catalogueModifierGroups,
      and(eq(catalogueModifierGroups.tenantId, catalogueModifierOptions.tenantId), eq(catalogueModifierGroups.id, catalogueModifierOptions.modifierGroupId)),
    )
    .where(and(eq(catalogueModifierOptions.tenantId, tenantId), eq(catalogueModifierOptions.publicId, publicId)))
    .limit(1)
    .for("share");
  if (!row) {
    throw new InventoryError("Modifier option not found.", 404, "option_not_found", field);
  }
  if (row.status === "archived" || row.groupStatus === "archived") {
    throw new InventoryError("This modifier option or its group is archived.", 400, "option_archived", field);
  }
  return row;
}

type ParsedEffect = {
  effectPublicId: string | null;
  modifierOptionId: string;
  effectType: (typeof EFFECT_TYPES)[number];
  targetLineId: string | null;
  itemId: string | null;
  unitId: string | null;
  quantityMicros: bigint | null;
  notes: string | null;
};

const present = (value: unknown) => value !== undefined && value !== null && value !== "";

/**
 * Replaces a draft's modifier effects with the ordered list sent. Existing
 * effects keep their public id; effects left out are marked removed.
 */
export async function replaceDraftEffects(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  versionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  if (!Array.isArray(body.effects)) {
    throw new InventoryError("Send the effects as a list.", 400, "body_invalid", "effects");
  }
  if (body.effects.length > MAX_EFFECTS) {
    throw new InventoryError(`A recipe version can have at most ${MAX_EFFECTS} modifier effects.`, 400, "effects_too_many", "effects");
  }
  const rawEffects = body.effects.map((effect) => asBody(effect));
  const context = { tenantId, actorSubject, membership };
  return withTenantContext(db, tenantId, async (tx) => {
    const { recipe, version } = await lockDraftInTx(tx, tenantId, recipePublicId, versionPublicId, expectedVersion);
    if (recipe.kind !== "sellable") {
      throw new InventoryError("Modifier effects apply to sellable recipes only.", 400, "effects_sellable_only", "effects");
    }
    const today = await tenantToday(tx, tenantId, now);
    const existing = await activeEffectsInTx(tx, tenantId, version.id);
    const existingByPublicId = new Map(existing.map((effect) => [effect.publicId, effect]));
      const lines = await tx
      .select()
      .from(recipeVersionLines)
      .where(and(eq(recipeVersionLines.tenantId, tenantId), eq(recipeVersionLines.recipeVersionId, version.id), eq(recipeVersionLines.status, "active")));
    const linesByPublicId = new Map(lines.map((line) => [line.publicId, line]));
    const applicable = await applicableOptionIdsInTx(tx, tenantId, recipe.id, today);
    const units = (await loadTenantUnitsInTx(tx, tenantId)).map(toGraphUnit);
    const parsed: ParsedEffect[] = [];
    const seenEffects = new Set<string>();
    const seenKeys = new Set<string>();
    for (const [index, raw] of rawEffects.entries()) {
      const field = (name: string) => `effects.${index}.${name}`;
      let effectPublicId: string | null = null;
      if (present(raw.effectPublicId)) {
        if (typeof raw.effectPublicId !== "string" || !existingByPublicId.has(raw.effectPublicId)) {
          throw new InventoryError("This effect was not found on the draft. Reload and try again.", 404, "effect_not_found", field("effectPublicId"));
        }
        if (seenEffects.has(raw.effectPublicId)) {
          throw new InventoryError("An effect was sent twice.", 400, "body_invalid", field("effectPublicId"));
        }
        seenEffects.add(raw.effectPublicId);
        effectPublicId = raw.effectPublicId;
      }
      const option = await loadOptionByPublicIdInTx(tx, tenantId, raw.optionPublicId, field("optionPublicId"));
      if (!applicable.has(option.id)) {
        throw new InventoryError(
          "This option's group is not attached to a product linked to this recipe.",
          400,
          "option_not_assigned",
          field("optionPublicId"),
        );
      }
      if (typeof raw.effectType !== "string" || !(EFFECT_TYPES as readonly string[]).includes(raw.effectType)) {
        throw new InventoryError("Choose add, remove or replace.", 400, "effect_type_invalid", field("effectType"));
      }
      const effectType = raw.effectType as ParsedEffect["effectType"];
      let targetLineId: string | null = null;
      if (effectType === "add") {
        if (present(raw.targetLinePublicId)) {
          throw new InventoryError("An add effect has no base line.", 400, "target_line_not_allowed", field("targetLinePublicId"));
        }
      } else {
        if (!present(raw.targetLinePublicId)) {
          throw new InventoryError("Choose the base line this effect removes or replaces.", 400, "target_line_required", field("targetLinePublicId"));
        }
        const line = typeof raw.targetLinePublicId === "string" ? linesByPublicId.get(raw.targetLinePublicId) : undefined;
        if (!line) {
          throw new InventoryError("This base line was not found on the draft. Reload and try again.", 404, "target_line_not_found", field("targetLinePublicId"));
        }
        targetLineId = line.id;
      }
      let itemId: string | null = null;
      let unitId: string | null = null;
      let quantityMicros: bigint | null = null;
      if (effectType === "remove") {
        if (present(raw.itemPublicId) || present(raw.unitPublicId) || present(raw.quantity)) {
          throw new InventoryError("A remove effect has no item, unit or quantity.", 400, "effect_item_not_allowed", field("itemPublicId"));
        }
      } else {
        if (!present(raw.itemPublicId)) {
          throw new InventoryError("Choose the item this effect adds.", 400, "effect_item_required", field("itemPublicId"));
        }
        const item = await loadReferencedItemInTx(tx, tenantId, raw.itemPublicId, field("itemPublicId"));
        const unit = await loadReferencedUnitInTx(tx, tenantId, raw.unitPublicId, field("unitPublicId"));
        const rules = (
          await tx
            .select()
            .from(inventoryItemConversions)
            .where(and(eq(inventoryItemConversions.tenantId, tenantId), eq(inventoryItemConversions.itemId, item.id)))
        ).filter((rule) => isLiveOn(rule.effectiveFrom, rule.effectiveTo, today));
        if (!item.storageUnitId || !findPath(buildItemGraph(units, rules.map(toGraphRule)), unit.id, item.storageUnitId)) {
          throw new InventoryError(
            "This unit cannot be converted to the item's storage unit. Add a conversion or choose another unit.",
            400,
            "effect_unit_not_convertible",
            field("unitPublicId"),
          );
        }
        itemId = item.id;
        unitId = unit.id;
        quantityMicros = parseUnitQuantity(raw.quantity, unit, field("quantity"), "quantity");
      }
      const key = effectType === "add" ? `add:${option.id}:${itemId}` : `line:${option.id}:${targetLineId}`;
      if (seenKeys.has(key)) {
        throw new InventoryError(
          "An option can remove or replace a base line once and add an item once per version.",
          400,
          "effect_duplicate",
          field("optionPublicId"),
        );
      }
      seenKeys.add(key);
      parsed.push({
        effectPublicId,
        modifierOptionId: option.id,
        effectType,
        targetLineId,
        itemId,
        unitId,
        quantityMicros,
        notes: parseOptionalLabel(raw.notes, field("notes"), EFFECT_NOTES_MAX_LENGTH, "effect_notes_too_long"),
      });
    }

    const stamp = { updatedAt: new Date(), updatedBySubject: actorSubject };
    // Mark every current effect removed first so a reorder never trips the partial unique indexes.
    if (existing.length > 0) {
      await tx
        .update(recipeVersionModifierEffects)
        .set({ status: "removed", ...stamp })
        .where(
          and(
            eq(recipeVersionModifierEffects.tenantId, tenantId),
            eq(recipeVersionModifierEffects.recipeVersionId, version.id),
            eq(recipeVersionModifierEffects.status, "active"),
          ),
        );
    }
    for (const [position, effect] of parsed.entries()) {
      const values = {
        effectType: effect.effectType,
        targetLineId: effect.targetLineId,
        itemId: effect.itemId,
        unitId: effect.unitId,
        quantityMicros: effect.quantityMicros,
        notes: effect.notes,
        position,
        status: "active" as const,
      };
      const kept = effect.effectPublicId ? existingByPublicId.get(effect.effectPublicId)! : null;
      if (kept && kept.modifierOptionId === effect.modifierOptionId) {
        await tx.update(recipeVersionModifierEffects).set({ ...values, ...stamp }).where(eq(recipeVersionModifierEffects.id, kept.id));
      } else {
        // An effect's option never changes (no UPDATE grant): a new option is a new effect, the old row stays removed.
        await tx.insert(recipeVersionModifierEffects).values({
          tenantId,
          publicId: generateEffectPublicId(),
          recipeVersionId: version.id,
          modifierOptionId: effect.modifierOptionId,
          ...values,
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        });
      }
    }
    const updated = await bumpVersionInTx(tx, version, actorSubject);
    await auditVersionInTx(tx, context, "recipe.version.effects.update", recipe, updated, {
      before: { effects: await effectSummariesInTx(tx, tenantId, existing) },
      after: { effects: await effectSummariesInTx(tx, tenantId, await activeEffectsInTx(tx, tenantId, version.id)) },
    });
    return loadRecipeDetailInTx(tx, tenantId, recipe, now);
  });
}
