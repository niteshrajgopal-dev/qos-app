import { and, eq, ne } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { type RecipeRecord, inventoryItems, recipes, recipeSellableLinks, recipeVersions } from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { type Dependency, InventoryConflictError, InventoryDependencyError, InventoryError } from "@/lib/inventory/errors";
import {
  asBody,
  parseExpectedVersion,
  parseOptionalName,
  parseOptionalText,
  parseRequiredName,
  parseStatus,
  requireInventoryAdministrator,
  tenantToday,
  uniqueViolationConstraint,
  versionConflict,
} from "@/lib/inventory/shared";
import { isOpenOn } from "@/lib/recipes/dates";
import {
  generateRecipePublicId,
  generateVersionPublicId,
  loadRecipeByPublicIdInTx,
  loadReferencedItemInTx,
  loadReferencedUnitInTx,
  parseUnitQuantity,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_NOTES_MAX_LENGTH,
} from "@/lib/recipes/shared";
import {
  buildRecipeDetail,
  buildRecipeSummary,
  loadRecipeWorldInTx,
  type RecipeDetailView,
  type RecipeSummaryView,
} from "@/lib/recipes/views";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-198 recipe families. A family is a sellable recipe (linked to sold
   variants under Sellable links) or a prepared recipe that describes how one
   prepared inventory item is made. Creating a family creates version 1 as a
   draft in the same transaction. Families are archived, never deleted;
   archive is refused while a sellable link still points at the family.
   Writes are administrator-only (D14, as for inventory setup records). */

export type RecipeKind = RecipeRecord["kind"];

function parseKind(value: unknown): RecipeKind {
  if (value !== "sellable" && value !== "prepared") {
    throw new InventoryError("Choose sellable or prepared.", 400, "recipe_kind_invalid", "kind");
  }
  return value;
}

export async function loadRecipeDetailInTx(tx: DbClient, tenantId: string, recipe: RecipeRecord, now: Date = new Date()) {
  const today = await tenantToday(tx, tenantId, now);
  const world = await loadRecipeWorldInTx(tx, tenantId, today, recipe.id);
  return buildRecipeDetail(world, recipe);
}

export async function listRecipes(db: DbClient, tenantId: string, now: Date = new Date()): Promise<{ recipes: RecipeSummaryView[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const today = await tenantToday(tx, tenantId, now);
    const world = await loadRecipeWorldInTx(tx, tenantId, today);
    return { recipes: world.recipes.map((recipe) => buildRecipeSummary(world, recipe)) };
  });
}

export async function getRecipe(db: DbClient, tenantId: string, recipePublicId: string): Promise<RecipeDetailView> {
  return withTenantContext(db, tenantId, async (tx) => {
    const recipe = await loadRecipeByPublicIdInTx(tx, tenantId, recipePublicId);
    return loadRecipeDetailInTx(tx, tenantId, recipe);
  });
}

/** Live sellable links (not ended by today) that point at the family. */
export async function recipeDependencies(tx: DbClient, tenantId: string, recipeId: string, today: string): Promise<Dependency[]> {
  const links = await tx
    .select({ effectiveTo: recipeSellableLinks.effectiveTo })
    .from(recipeSellableLinks)
    .where(and(eq(recipeSellableLinks.tenantId, tenantId), eq(recipeSellableLinks.recipeId, recipeId)));
  const live = links.filter((link) => isOpenOn(link.effectiveTo, today)).length;
  return live > 0 ? [{ kind: "sellable_links", count: live }] : [];
}

/**
 * The prepared output item: an active item of kind prepared that no other
 * active family produces, so how a prepared item is made is never ambiguous.
 */
async function resolveOutputItem(tx: DbClient, tenantId: string, publicId: unknown, exceptRecipeId: string | null) {
  if (publicId == null || publicId === "") {
    throw new InventoryError("Choose the prepared item this recipe makes.", 400, "output_item_required", "outputItemPublicId");
  }
  const item = await loadReferencedItemInTx(tx, tenantId, publicId, "outputItemPublicId");
  if (item.kind !== "prepared") {
    throw new InventoryError(
      "The output of a prepared recipe must be a prepared item.",
      400,
      "output_item_not_prepared",
      "outputItemPublicId",
    );
  }
  await assertOutputItemFree(tx, tenantId, item.id, exceptRecipeId);
  return item;
}

async function assertOutputItemFree(tx: DbClient, tenantId: string, itemId: string, exceptRecipeId: string | null) {
  const owners = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.tenantId, tenantId),
        eq(recipes.outputItemId, itemId),
        eq(recipes.status, "active"),
        ...(exceptRecipeId ? [ne(recipes.id, exceptRecipeId)] : []),
      ),
    )
    .limit(1);
  if (owners.length > 0) {
    throw outputItemTaken();
  }
}

function outputItemTaken() {
  return new InventoryConflictError(
    "Another active recipe already makes this prepared item.",
    "output_item_taken",
    "outputItemPublicId",
  );
}

function auditRecipe(row: RecipeRecord, outputItemPublicId: string | null) {
  return {
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    kind: row.kind,
    outputItem: outputItemPublicId,
    notes: row.notes,
    status: row.status,
  };
}

async function outputPublicId(tx: DbClient, tenantId: string, itemId: string | null) {
  if (!itemId) return null;
  const [row] = await tx
    .select({ publicId: inventoryItems.publicId })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.id, itemId)))
    .limit(1);
  return row?.publicId ?? null;
}

/** Creates a family and its version 1 draft (optionally with a first yield). Returns the detail view. */
export async function createRecipe(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const nameEn = parseRequiredName(body.nameEn, "nameEn", RECIPE_NAME_MAX_LENGTH);
  const nameAr = parseOptionalName(body.nameAr, "nameAr", RECIPE_NAME_MAX_LENGTH);
  const kind = parseKind(body.kind);
  const notes = parseOptionalText(body.notes, "notes", RECIPE_NOTES_MAX_LENGTH);
  if (kind === "sellable" && body.outputItemPublicId != null && body.outputItemPublicId !== "") {
    throw new InventoryError(
      "A sellable recipe has no output item. Link it to sold variants instead.",
      400,
      "output_item_not_allowed",
      "outputItemPublicId",
    );
  }
  const hasYield = body.yieldQuantity != null && body.yieldQuantity !== "";
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const output = kind === "prepared" ? await resolveOutputItem(tx, tenantId, body.outputItemPublicId, null) : null;
      const yieldUnit =
        body.yieldUnitPublicId != null && body.yieldUnitPublicId !== ""
          ? await loadReferencedUnitInTx(tx, tenantId, body.yieldUnitPublicId, "yieldUnitPublicId")
          : null;
      const yieldMicros = hasYield ? parseUnitQuantity(body.yieldQuantity, yieldUnit, "yieldQuantity", "yield") : null;
      const [recipe] = await tx
        .insert(recipes)
        .values({
          tenantId,
          publicId: generateRecipePublicId(nameEn),
          nameEn,
          nameAr,
          kind,
          outputItemId: output?.id ?? null,
          notes,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      const [draft] = await tx
        .insert(recipeVersions)
        .values({
          tenantId,
          publicId: generateVersionPublicId(),
          recipeId: recipe!.id,
          versionNumber: 1,
          status: "draft",
          yieldQuantityMicros: yieldMicros,
          yieldUnitId: yieldUnit?.id ?? null,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "recipe.create",
        entityType: "recipe",
        entityPublicId: recipe!.publicId,
        entityVersion: recipe!.version,
        changeSummary: {
          after: auditRecipe(recipe!, output?.publicId ?? null),
          draftVersion: { versionPublicId: draft!.publicId, versionNumber: 1 },
        },
      });
      return loadRecipeDetailInTx(tx, tenantId, recipe!, now);
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) === "recipes_active_output_item_unique") {
      throw outputItemTaken();
    }
    throw error;
  }
}

/**
 * Edits names and notes, archives or restores the family. Kind and output
 * item may change only while no version has ever been approved.
 */
export async function updateRecipe(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const nameEn = body.nameEn === undefined ? undefined : parseRequiredName(body.nameEn, "nameEn", RECIPE_NAME_MAX_LENGTH);
  const nameAr = body.nameAr === undefined ? undefined : parseOptionalName(body.nameAr, "nameAr", RECIPE_NAME_MAX_LENGTH);
  const notes = body.notes === undefined ? undefined : parseOptionalText(body.notes, "notes", RECIPE_NOTES_MAX_LENGTH);
  const status = parseStatus(body.status);
  const kind = body.kind === undefined ? undefined : parseKind(body.kind);
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const recipe = await loadRecipeByPublicIdInTx(tx, tenantId, recipePublicId, "update");
      if (recipe.version !== expectedVersion) {
        throw versionConflict();
      }
      const today = await tenantToday(tx, tenantId, now);
      const nextKind = kind ?? recipe.kind;
      let outputItemId = recipe.outputItemId;
      const outputChange = body.outputItemPublicId !== undefined;
      if (nextKind !== recipe.kind || outputChange) {
        const approved = await tx
          .select({ id: recipeVersions.id })
          .from(recipeVersions)
          .where(
            and(eq(recipeVersions.tenantId, tenantId), eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.status, "approved")),
          )
          .limit(1);
        if (approved.length > 0) {
          throw new InventoryConflictError(
            "The kind and output item are fixed once a version has been approved. Create a new recipe instead.",
            "recipe_kind_immutable",
            "kind",
          );
        }
        if (nextKind === "prepared") {
          const dependencies = await recipeDependencies(tx, tenantId, recipe.id, today);
          if (dependencies.length > 0) {
            throw new InventoryDependencyError(
              "This recipe is linked to sold variants. End those links before making it a prepared recipe.",
              "recipe_in_use",
              "kind",
              dependencies,
            );
          }
          outputItemId = (await resolveOutputItem(tx, tenantId, body.outputItemPublicId ?? null, recipe.id)).id;
        } else {
          if (body.outputItemPublicId != null && body.outputItemPublicId !== "") {
            throw new InventoryError(
              "A sellable recipe has no output item. Link it to sold variants instead.",
              400,
              "output_item_not_allowed",
              "outputItemPublicId",
            );
          }
          outputItemId = null;
        }
      }
      const nextStatus = status ?? recipe.status;
      if (nextStatus === "archived" && recipe.status !== "archived") {
        const dependencies = await recipeDependencies(tx, tenantId, recipe.id, today);
        if (dependencies.length > 0) {
          throw new InventoryDependencyError(
            "This recipe is still linked to sold variants and cannot be archived. End those links first.",
            "recipe_in_use",
            "status",
            dependencies,
          );
        }
      }
      if (nextStatus === "active" && recipe.status !== "active" && outputItemId) {
        await assertOutputItemFree(tx, tenantId, outputItemId, recipe.id);
      }
      const [updated] = await tx
        .update(recipes)
        .set({
          nameEn: nameEn ?? recipe.nameEn,
          nameAr: nameAr === undefined ? recipe.nameAr : nameAr,
          notes: notes === undefined ? recipe.notes : notes,
          kind: nextKind,
          outputItemId,
          status: nextStatus,
          version: recipe.version + 1,
          updatedAt: new Date(),
          updatedBySubject: actorSubject,
        })
        .where(and(eq(recipes.id, recipe.id), eq(recipes.version, expectedVersion)))
        .returning();
      if (!updated) {
        throw versionConflict();
      }
      const action =
        updated.status !== recipe.status ? (updated.status === "archived" ? "recipe.archive" : "recipe.restore") : "recipe.update";
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action,
        entityType: "recipe",
        entityPublicId: updated.publicId,
        entityVersion: updated.version,
        changeSummary: {
          before: auditRecipe(recipe, await outputPublicId(tx, tenantId, recipe.outputItemId)),
          after: auditRecipe(updated, await outputPublicId(tx, tenantId, updated.outputItemId)),
        },
      });
      return loadRecipeDetailInTx(tx, tenantId, updated, now);
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) === "recipes_active_output_item_unique") {
      throw outputItemTaken();
    }
    throw error;
  }
}

