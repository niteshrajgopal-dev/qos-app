import { and, desc, eq, isNull } from "drizzle-orm";

import { catalogueVariants, recipes, recipeSellableLinks, recipeVersions } from "@/db/schema";
import { createSellableLink } from "@/lib/recipes/links";
import { createRecipe, updateRecipe } from "@/lib/recipes/recipes";
import { createDraftFromVersion, updateDraftVersion } from "@/lib/recipes/versions";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { present, proposedValues, requireTarget, resolveReference, text, type Values } from "@/lib/workbook/apply/handlers/shared";
import type { HandlerContext, SavedRow, SheetHandler } from "@/lib/workbook/apply/handlers/types";
import type { AppliedRecord } from "@/lib/workbook/apply/model";
import { RECIPE_TARGET_KIND } from "@/lib/workbook/phase2-values";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";
import { RECIPE_FAMILY_LINKS } from "@/lib/workbook/validation/snapshot";

/* Recipes (QOS-200, decision D4): one unit saves the family, its DRAFT
   version and the sold variant's recipe link through the QOS-198 services.
   A new family is created with version 1 as a draft. A row for an approved
   (or discarded) version never changes it: a draft is created from it and
   patched, and the row's key follows the draft. An open draft someone else
   started is never patched silently: the row fails `conflict` /
   `draft_exists` and stays reviewable. Nothing here approves a version;
   effective dates are set by approval in the recipe editor. */

const FIELDS = ["recipe_key", "name", "target_type", "yield_quantity", "notes"];
const REFERENCES = ["variant_key", "prepared_ingredient_key", "yield_unit_key"];

type Family = typeof recipes.$inferSelect;
type Version = typeof recipeVersions.$inferSelect;

async function lockFamily(context: HandlerContext, where: { publicId?: string; id?: string }) {
  const [family] = await context.tx
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.tenantId, context.run.tenantId),
        where.publicId ? eq(recipes.publicId, where.publicId) : eq(recipes.id, where.id!),
      ),
    )
    .limit(1)
    .for("update");
  if (!family) throw new ApplyUnitError("target_not_found", "Recipe not found.");
  return family;
}

async function versionsOf(context: HandlerContext, familyId: string) {
  return context.tx
    .select()
    .from(recipeVersions)
    .where(and(eq(recipeVersions.tenantId, context.run.tenantId), eq(recipeVersions.recipeId, familyId)))
    .orderBy(desc(recipeVersions.versionNumber));
}

async function versionByPublicId(context: HandlerContext, publicId: string) {
  const [version] = await context.tx
    .select()
    .from(recipeVersions)
    .where(and(eq(recipeVersions.tenantId, context.run.tenantId), eq(recipeVersions.publicId, publicId)))
    .limit(1);
  if (!version) throw new ApplyUnitError("target_not_found", "Recipe version not found.");
  return version;
}

function draftExists(): never {
  throw new ApplyUnitError("conflict", "This recipe already has an open draft. Choose it in the review, or approve or discard it first.", {
    field: "recipe_key",
    reason: "draft_exists",
  });
}

/**
 * The existing family a new Recipes row belongs to: a typed `recipe` link of
 * its recipe_key, the family id itself in a QOS export namespace, or the
 * family another Recipes row of this plan already saved. Names never count.
 */
async function existingFamily(context: HandlerContext, row: PlanRowRecord): Promise<string | null> {
  const { run } = context;
  const key = (row.after?.recipe_key ?? "").trim();
  if (!key) return null;
  const linked = run.snapshot.typedLinks.get(RECIPE_FAMILY_LINKS)?.get(key);
  if (linked) return linked;
  if (run.plan.keysVerified && [...run.snapshot.records.Recipes.values()].some((record) => record.recipe_key === key)) return key;
  for (const other of run.rowsByKey.get("Recipes")?.values() ?? []) {
    if (other.id === row.id || (other.after?.recipe_key ?? "").trim() !== key) continue;
    const saved = run.saved.get(other.id) ?? other.appliedPublicId;
    if (!saved) continue;
    const version = await versionByPublicId(context, saved);
    const [family] = await context.tx.select({ publicId: recipes.publicId }).from(recipes).where(eq(recipes.id, version.recipeId)).limit(1);
    if (family) return family.publicId;
  }
  return null;
}

/** Draft fields of a row: only what it proposes (all of it on create). */
function draftPatch(context: HandlerContext, row: PlanRowRecord, values: Values) {
  return {
    ...(values.has("yield_quantity") ? { yieldQuantity: text(values, "yield_quantity") } : {}),
    ...(values.has("yield_unit_key") ? { yieldUnitPublicId: text(values, "yield_unit_key") === null ? null : resolveReference(context.run, row, "yield_unit_key") } : {}),
    ...(values.has("notes") ? { notes: text(values, "notes") } : {}),
  };
}

/** Family fields a row changes: the English name, and kind or prepared item (refused by the service once approved). */
function familyPatch(context: HandlerContext, row: PlanRowRecord, values: Values, family: Family) {
  const kind = values.has("target_type") ? RECIPE_TARGET_KIND[text(values, "target_type") ?? ""] : undefined;
  const name = text(values, "name");
  return {
    ...(values.has("name") && name && name !== family.nameEn ? { nameEn: name } : {}),
    ...(kind && kind !== family.kind ? { kind } : {}),
    ...(values.has("prepared_ingredient_key")
      ? { outputItemPublicId: text(values, "prepared_ingredient_key") === null ? null : resolveReference(context.run, row, "prepared_ingredient_key") }
      : {}),
  };
}

/**
 * The sold variant's recipe link: created when the variant has none, kept
 * when it already points at this family. A live link to another family or a
 * direct-stock link is never replaced by an import (`variant_linked_elsewhere`).
 */
async function ensureSellableLink(context: HandlerContext, row: PlanRowRecord, family: Family): Promise<AppliedRecord | null> {
  const { run } = context;
  if (family.kind !== "sellable" || !(row.after?.variant_key ?? "").trim()) return null;
  const variantPublicId = resolveReference(run, row, "variant_key");
  const [variant] = await context.tx
    .select({ id: catalogueVariants.id })
    .from(catalogueVariants)
    .where(and(eq(catalogueVariants.tenantId, run.tenantId), eq(catalogueVariants.publicId, variantPublicId)))
    .limit(1);
  if (!variant) throw new ApplyUnitError("target_not_found", "Variant not found.", { field: "variant_key" });
  const open = async () =>
    (
      await context.tx
        .select()
        .from(recipeSellableLinks)
        .where(and(eq(recipeSellableLinks.tenantId, run.tenantId), eq(recipeSellableLinks.variantId, variant.id), isNull(recipeSellableLinks.effectiveTo)))
        .limit(1)
    )[0];
  const current = await open();
  if (current) {
    if (current.kind === "recipe" && current.recipeId === family.id) return null;
    throw new ApplyUnitError("conflict", "This variant already has a live recipe or stock link; end it in the recipe editor first.", {
      field: "variant_key",
      reason: "variant_linked_elsewhere",
    });
  }
  await createSellableLink(context.db, run.tenantId, run.membership, run.actor.subject, { variantPublicId, kind: "recipe", recipePublicId: family.publicId });
  const created = await open();
  return created ? { kind: "sellable_link", publicId: created.publicId, revision: created.revision, created: true, effectiveFrom: created.effectiveFrom } : null;
}

function savedRow(row: PlanRowRecord, values: Values, family: Family, draft: Version, records: AppliedRecord[], created: boolean): SavedRow {
  const key = (row.after?.recipe_key ?? row.before?.recipe_key ?? "").trim();
  return {
    row,
    publicId: draft.publicId,
    ...(created ? { created: true } : {}),
    fieldsApplied: present(values, ...FIELDS, ...REFERENCES),
    parentPublicId: family.publicId,
    records,
    ...(key ? { extraLinks: [{ entityType: "recipe" as const, sourceKey: key, targetPublicId: family.publicId }] } : {}),
  };
}

/** A draft made from `source`, patched with the row's draft and family fields. */
async function draftFrom(context: HandlerContext, row: PlanRowRecord, values: Values, family: Family, source: Version) {
  const { run } = context;
  const before = await versionsOf(context, family.id);
  if (before.some((version) => version.status === "draft")) draftExists();
  await createDraftFromVersion(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, { fromVersionPublicId: source.publicId });
  const draft = (await versionsOf(context, family.id)).find((version) => version.status === "draft")!;
  return patchDraft(context, row, values, family, draft);
}

async function patchDraft(context: HandlerContext, row: PlanRowRecord, values: Values, family: Family, draft: Version) {
  const { run } = context;
  const patch = draftPatch(context, row, values);
  if (Object.keys(patch).length > 0) {
    await updateDraftVersion(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, draft.publicId, {
      expectedVersion: draft.version,
      ...patch,
    });
  }
  const familyFields = familyPatch(context, row, values, family);
  let current = family;
  if (Object.keys(familyFields).length > 0) {
    await updateRecipe(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, { expectedVersion: family.version, ...familyFields });
    current = await lockFamily(context, { id: family.id });
  }
  return { family: current, draft: await versionByPublicId(context, draft.publicId) };
}

export const applyRecipes: SheetHandler = async (context, unit) => {
  const { run } = context;
  const row = unit.rows[0]!;
  const values = proposedValues(row);

  if (row.operation === "create") {
    const familyPublicId = await existingFamily(context, row);
    if (!familyPublicId) {
      const after = row.after ?? {};
      const kind = RECIPE_TARGET_KIND[after.target_type ?? ""];
      const detail = await createRecipe(context.db, run.tenantId, run.membership, run.actor.subject, {
        nameEn: after.name ?? "",
        kind,
        ...(kind === "prepared" ? { outputItemPublicId: resolveReference(run, row, "prepared_ingredient_key") } : {}),
        ...(after.yield_quantity ? { yieldQuantity: after.yield_quantity } : {}),
        ...(after.yield_unit_key ? { yieldUnitPublicId: resolveReference(run, row, "yield_unit_key") } : {}),
      });
      const family = await lockFamily(context, { publicId: detail.recipe.publicId });
      let draft = (await versionsOf(context, family.id)).find((version) => version.status === "draft")!;
      if (after.notes) {
        await updateDraftVersion(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, draft.publicId, {
          expectedVersion: draft.version,
          notes: after.notes,
        });
        draft = await versionByPublicId(context, draft.publicId);
      }
      const records: AppliedRecord[] = [
        { kind: "recipe", publicId: family.publicId, created: true },
        { kind: "recipe_version", publicId: draft.publicId, revision: draft.versionNumber, created: true },
      ];
      const link = await ensureSellableLink(context, row, family);
      if (link) records.push(link);
      return [savedRow(row, values, family, draft, records, true)];
    }
    // A new version of an existing family: a draft from its newest approved version (else its newest one).
    await context.guard.enter({ kind: "recipe", recipePublicId: familyPublicId }, []);
    const family = await lockFamily(context, { publicId: familyPublicId });
    const versions = await versionsOf(context, family.id);
    if (versions.some((version) => version.status === "draft")) draftExists();
    const source = versions.find((version) => version.status === "approved") ?? versions[0];
    if (!source) throw new ApplyUnitError("target_not_found", "Recipe version not found.");
    const saved = await draftFrom(context, row, values, family, source);
    const records: AppliedRecord[] = [{ kind: "recipe_version", publicId: saved.draft.publicId, revision: saved.draft.versionNumber, created: true }];
    const link = await ensureSellableLink(context, row, saved.family);
    if (link) records.push(link);
    return [savedRow(row, values, saved.family, saved.draft, records, true)];
  }

  const targetPublicId = requireTarget(row);
  const target = await versionByPublicId(context, targetPublicId);
  const family = await lockFamily(context, { id: target.recipeId });
  await context.guard.enter({ kind: "recipe", recipePublicId: family.publicId }, [row]);
  const version = await versionByPublicId(context, targetPublicId);

  if (row.operation === "archive") {
    if (version.status !== "draft") {
      throw new ApplyUnitError("service_validation", "Approved versions cannot change; a new draft is created instead.", { reason: "version_not_draft" });
    }
    await updateDraftVersion(context.db, run.tenantId, run.membership, run.actor.subject, family.publicId, version.publicId, {
      expectedVersion: version.version,
      status: "discarded",
    });
    return [savedRow(row, values, family, version, [], false)];
  }

  const records: AppliedRecord[] = [];
  let saved: { family: Family; draft: Version };
  if (version.status === "draft") {
    saved = await patchDraft(context, row, values, family, version);
  } else {
    // D4: an approved version is never mutated; the row saves a new draft made from it.
    saved = await draftFrom(context, row, values, family, version);
    records.push({ kind: "recipe_version", publicId: saved.draft.publicId, revision: saved.draft.versionNumber, created: true });
  }
  if (values.has("variant_key")) {
    const link = await ensureSellableLink(context, row, saved.family);
    if (link) records.push(link);
  }
  return [savedRow(row, values, saved.family, saved.draft, records, false)];
};
