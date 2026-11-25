import { and, eq, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { type RecipeSellableLinkRecord, catalogueVariants, recipeSellableLinks } from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { buildItemGraph, findPath } from "@/lib/inventory/conversion-graph";
import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import { fromMicros, microsToDecimalString, mul } from "@/lib/inventory/quantity-math";
import {
  asBody,
  loadTenantUnitsInTx,
  parseOptionalDate,
  requireInventoryAdministrator,
  tenantToday,
  toUnitView,
  uniqueViolationConstraint,
  type UnitView,
} from "@/lib/inventory/shared";
import { isLiveOn, versionPhase } from "@/lib/recipes/dates";
import {
  assertRecipeActive,
  generateLinkPublicId,
  loadRecipeByPublicIdInTx,
  loadReferencedItemInTx,
  loadReferencedUnitInTx,
  loadVariantByPublicIdInTx,
  parseUnitQuantity,
} from "@/lib/recipes/shared";
import { type RecipeStateKey, variantStates } from "@/lib/recipes/states";
import {
  type DecimalView,
  type ItemRef,
  itemRef,
  loadRecipeWorldInTx,
  type PickerItem,
  pickerItems,
  quantityView,
  type RecipeWorld,
  toGraphRule,
  toGraphUnit,
  type UnitRef,
  unitRef,
} from "@/lib/recipes/views";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-198 sellable links: which recipe family, or which stock item and
   quantity, one sale of a catalogue variant uses. One table holds both kinds;
   rows are append-only revisions per variant and only effective_to is ever
   updated, so a change is "end and insert", never a rewrite. At most one open
   link per variant (database index), so a recipe link and a direct-stock link
   are exclusive. Many variants may point at the same family (a shared
   assignment) without copying it. The QOS-214 stock-product flag is shown as
   "needs a direct-stock link" and never creates a link by itself. Shared and
   direct-stock links are outside the workbook template. */

export type WorkbookProfile = "default" | "shared" | "direct_stock";

export type SellableLinkView = {
  publicId: string;
  kind: RecipeSellableLinkRecord["kind"];
  revision: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** The link starts after today; the previous link (if any) still applies until then. */
  scheduled: boolean;
  recipe: {
    publicId: string;
    nameEn: string;
    nameAr: string | null;
    status: "active" | "archived";
    currentVersionNumber: number | null;
    hasDraft: boolean;
    linkedVariantCount: number;
  } | null;
  directStock: {
    item: ItemRef;
    quantity: string;
    unit: UnitRef;
    /** One sale's quantity in the item's storage unit, or missing when no conversion path exists. */
    inStorageUnit: DecimalView | null;
  } | null;
  workbookProfile: WorkbookProfile;
};

export type VariantLinkRowView = {
  variantPublicId: string;
  productPublicId: string;
  productNameEn: string;
  productNameAr: string | null;
  productStatus: "draft" | "active" | "archived";
  variantNameEn: string | null;
  variantNameAr: string | null;
  isDefault: boolean;
  variantStatus: "draft" | "active" | "archived";
  sellingQuantityBasis: string | null;
  directStockIntent: boolean | null;
  link: SellableLinkView | null;
  states: RecipeStateKey[];
};

export type SellableLinksView = {
  variants: VariantLinkRowView[];
  today: string;
  pickers: {
    recipes: Array<{ publicId: string; nameEn: string; nameAr: string | null }>;
    items: PickerItem[];
    units: UnitView[];
  };
};

function linkView(world: RecipeWorld, link: RecipeSellableLinkRecord): SellableLinkView {
  const unitsById = new Map(world.units.map((unit) => [unit.id, unit]));
  let recipe: SellableLinkView["recipe"] = null;
  let directStock: SellableLinkView["directStock"] = null;
  let profile: WorkbookProfile = "direct_stock";
  if (link.kind === "recipe") {
    const family = world.recipes.find((row) => row.id === link.recipeId)!;
    const versions = world.versions.filter((version) => version.recipeId === family.id);
    const current = versions.find((version) => versionPhase(version, world.today) === "current") ?? null;
    const linkedVariantCount = world.links.filter((row) => row.kind === "recipe" && row.recipeId === family.id && row.effectiveTo === null).length;
    recipe = {
      publicId: family.publicId,
      nameEn: family.nameEn,
      nameAr: family.nameAr,
      status: family.status,
      currentVersionNumber: current?.versionNumber ?? null,
      hasDraft: versions.some((version) => version.status === "draft"),
      linkedVariantCount,
    };
    profile = linkedVariantCount > 1 ? "shared" : "default";
  } else {
    const item = world.items.find((row) => row.id === link.itemId)!;
    const unit = unitsById.get(link.unitId!)!;
    const storage = item.storageUnitId ? unitsById.get(item.storageUnitId) ?? null : null;
    const path = storage
      ? findPath(
          buildItemGraph(world.units.map(toGraphUnit), world.rules.filter((rule) => rule.itemId === item.id).map(toGraphRule)),
          unit.id,
          storage.id,
        )
      : null;
    directStock = {
      item: itemRef(item, unitsById),
      quantity: microsToDecimalString(link.quantityMicros!),
      unit: unitRef(unit),
      inStorageUnit: path && storage ? quantityView(mul(fromMicros(link.quantityMicros!), path.factor), storage.decimalPlaces) : null,
    };
  }
  return {
    publicId: link.publicId,
    kind: link.kind,
    revision: link.revision,
    effectiveFrom: link.effectiveFrom,
    effectiveTo: link.effectiveTo,
    scheduled: link.effectiveFrom > world.today,
    recipe,
    directStock,
    workbookProfile: profile,
  };
}

export function buildSellableLinks(world: RecipeWorld): SellableLinksView {
  const rows: VariantLinkRowView[] = [];
  for (const variant of world.variants) {
    const links = world.links.filter((link) => link.variantId === variant.id);
    // The link that applies today, else the next one that starts later (world.links holds only links not ended by today).
    const shown =
      links.find((link) => isLiveOn(link.effectiveFrom, link.effectiveTo, world.today)) ??
      [...links].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.revision - b.revision)[0] ??
      null;
    const eligible = variant.status === "active" && variant.product.status !== "archived";
    if (!eligible && !shown) continue;
    const view = shown ? linkView(world, shown) : null;
    const states = variantStates({
      variantStatus: variant.status,
      productStatus: variant.product.status,
      sellingQuantityBasis: variant.sellingQuantityBasis,
      directStockIntent: variant.product.directStockIntent,
      liveLinkKind: shown?.kind ?? null,
    });
    if (view?.recipe) {
      if (view.recipe.currentVersionNumber === null) states.push(view.recipe.hasDraft ? "draft_pending" : "no_approved_version");
    }
    if (view?.directStock) {
      if (view.directStock.item.status !== "active") states.push("item_archived");
      if (!view.directStock.inStorageUnit) states.push("missing_conversion");
    }
    rows.push({
      variantPublicId: variant.publicId,
      productPublicId: variant.product.publicId,
      productNameEn: variant.product.nameEn,
      productNameAr: variant.product.nameAr,
      productStatus: variant.product.status,
      variantNameEn: variant.nameEn,
      variantNameAr: variant.nameAr,
      isDefault: variant.isDefault,
      variantStatus: variant.status,
      sellingQuantityBasis: variant.sellingQuantityBasis,
      directStockIntent: variant.product.directStockIntent,
      link: view,
      states,
    });
  }
  return {
    variants: rows,
    today: world.today,
    pickers: {
      recipes: world.recipes
        .filter((recipe) => recipe.kind === "sellable" && recipe.status === "active")
        .map((recipe) => ({ publicId: recipe.publicId, nameEn: recipe.nameEn, nameAr: recipe.nameAr })),
      items: pickerItems(world),
      units: world.units.filter((unit) => unit.status === "active").map(toUnitView),
    },
  };
}

async function loadLinksViewInTx(tx: DbClient, tenantId: string, now: Date) {
  const today = await tenantToday(tx, tenantId, now);
  return buildSellableLinks(await loadRecipeWorldInTx(tx, tenantId, today));
}

export async function listSellableLinks(db: DbClient, tenantId: string, now: Date = new Date()): Promise<SellableLinksView> {
  return withTenantContext(db, tenantId, (tx) => loadLinksViewInTx(tx, tenantId, now));
}

function linkExists() {
  return new InventoryConflictError(
    "This variant already has a link. Replace it or end it first.",
    "link_exists",
    "variantPublicId",
  );
}

async function linkSummary(tx: DbClient, tenantId: string, link: RecipeSellableLinkRecord, variantPublicId: string) {
  const units = new Map((await loadTenantUnitsInTx(tx, tenantId)).map((unit) => [unit.id, unit]));
  return {
    linkPublicId: link.publicId,
    variantPublicId,
    kind: link.kind,
    quantity: link.quantityMicros === null ? null : microsToDecimalString(link.quantityMicros),
    unit: link.unitId ? units.get(link.unitId)?.code ?? null : null,
    effectiveFrom: link.effectiveFrom,
    effectiveTo: link.effectiveTo,
    revision: link.revision,
  };
}

/**
 * Links a variant to a sellable recipe family or to a stock item, quantity
 * and unit. With `replace: true` the variant's open link is ended on the new
 * link's start date in the same transaction; without it an open link is a
 * conflict.
 */
export async function createSellableLink(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  input: unknown,
  now: Date = new Date(),
): Promise<SellableLinksView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const kind = body.kind;
  if (kind !== "recipe" && kind !== "direct_stock") {
    throw new InventoryError("Choose a recipe link or a direct stock link.", 400, "link_kind_invalid", "kind");
  }
  const directFields = [body.itemPublicId, body.quantity, body.unitPublicId];
  if (kind === "recipe" && directFields.some((value) => value != null && value !== "")) {
    throw new InventoryError("A recipe link has no item, quantity or unit.", 400, "link_kind_invalid", "kind");
  }
  if (kind === "direct_stock") {
    if (directFields.some((value) => value == null || value === "")) {
      throw new InventoryError(
        "A direct stock link needs an item, a quantity and a unit.",
        400,
        "direct_stock_fields_required",
        "itemPublicId",
      );
    }
    if (body.recipePublicId != null && body.recipePublicId !== "") {
      throw new InventoryError("A direct stock link has no recipe.", 400, "link_kind_invalid", "kind");
    }
  }
  const requestedFrom = parseOptionalDate(body.effectiveFrom);
  const replace = body.replace === true;
  const context = { tenantId, actorSubject, membership };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const variant = await loadVariantByPublicIdInTx(tx, tenantId, body.variantPublicId);
      if (variant.status === "archived") {
        throw new InventoryError("This variant is archived and cannot be linked.", 400, "variant_archived", "variantPublicId");
      }
      if (variant.productStatus === "archived") {
        throw new InventoryError("This product is archived and its variants cannot be linked.", 400, "product_archived", "variantPublicId");
      }
      const values: Partial<RecipeSellableLinkRecord> = {};
      if (kind === "recipe") {
        const recipe = await loadRecipeByPublicIdInTx(tx, tenantId, body.recipePublicId, "share");
        assertRecipeActive(recipe);
        if (recipe.kind !== "sellable") {
          throw new InventoryError(
            "A prepared recipe describes a prepared item and cannot be linked to a sold variant.",
            400,
            "recipe_kind_not_sellable",
            "recipePublicId",
          );
        }
        values.recipeId = recipe.id;
      } else {
        const item = await loadReferencedItemInTx(tx, tenantId, body.itemPublicId, "itemPublicId");
        const unit = await loadReferencedUnitInTx(tx, tenantId, body.unitPublicId, "unitPublicId");
        values.itemId = item.id;
        values.unitId = unit.id;
        values.quantityMicros = parseUnitQuantity(body.quantity, unit, "quantity", "quantity");
      }
      const rows = await tx
        .select()
        .from(recipeSellableLinks)
        .where(and(eq(recipeSellableLinks.tenantId, tenantId), eq(recipeSellableLinks.variantId, variant.id)))
        .for("update");
      const open = rows.find((row) => row.effectiveTo === null) ?? null;
      if (open && !replace) {
        throw linkExists();
      }
      const today = await tenantToday(tx, tenantId, now);
      const lastEnded = rows.reduce<string | null>(
        (latest, row) => (row.effectiveTo && (!latest || row.effectiveTo > latest) ? row.effectiveTo : latest),
        null,
      );
      const floor = [open?.effectiveFrom ?? null, lastEnded].filter((value): value is string => value !== null).sort().at(-1) ?? null;
      const effectiveFrom = requestedFrom ?? (floor && floor > today ? floor : today);
      if (floor && effectiveFrom < floor) {
        throw new InventoryError(
          `The start date cannot be earlier than ${floor}, the date of the variant's current or last link. History is not rewritten.`,
          400,
          "effective_from_before_current",
          "effectiveFrom",
        );
      }
      if (open) {
        const [ended] = await tx
          .update(recipeSellableLinks)
          .set({ effectiveTo: effectiveFrom })
          .where(and(eq(recipeSellableLinks.id, open.id), isNull(recipeSellableLinks.effectiveTo)))
          .returning();
        if (!ended) throw linkExists();
        await recordTenantAuditEventInTx(tx, {
          tenantId,
          actorSubject,
          actorClass: auditActorClassFromStaffRole(context.membership.role),
          action: "recipe.link.end",
          entityType: "recipe_sellable_link",
          entityPublicId: ended.publicId,
          entityVersion: ended.revision,
          changeSummary: { before: await linkSummary(tx, tenantId, open, variant.publicId), after: await linkSummary(tx, tenantId, ended, variant.publicId), replaced: true },
        });
      }
      const revision = rows.reduce((highest, row) => Math.max(highest, row.revision), 0) + 1;
      const [inserted] = await tx
        .insert(recipeSellableLinks)
        .values({
          tenantId,
          publicId: generateLinkPublicId(),
          variantId: variant.id,
          kind,
          recipeId: values.recipeId ?? null,
          itemId: values.itemId ?? null,
          quantityMicros: values.quantityMicros ?? null,
          unitId: values.unitId ?? null,
          effectiveFrom,
          effectiveTo: null,
          revision,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
        })
        .returning();
      const summary = await linkSummary(tx, tenantId, inserted!, variant.publicId);
      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject,
        actorClass: auditActorClassFromStaffRole(context.membership.role),
        action: "recipe.link.create",
        entityType: "recipe_sellable_link",
        entityPublicId: inserted!.publicId,
        entityVersion: inserted!.revision,
        changeSummary: {
          after: {
            ...summary,
            recipePublicId: typeof body.recipePublicId === "string" && kind === "recipe" ? body.recipePublicId : null,
            itemPublicId: typeof body.itemPublicId === "string" && kind === "direct_stock" ? body.itemPublicId : null,
          },
          replacedLinkPublicId: open?.publicId ?? null,
        },
      });
      return loadLinksViewInTx(tx, tenantId, now);
    });
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === "recipe_sellable_links_current_unique" || constraint === "recipe_sellable_links_revision_unique") {
      throw linkExists();
    }
    throw error;
  }
}

/** PATCH: `{ operation: "end", effectiveTo? }` ends an open link (default today, never before its start). */
export async function updateSellableLink(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  linkPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<SellableLinksView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  if (body.operation !== "end") {
    throw new InventoryError("operation must be end.", 400, "operation_invalid", "operation");
  }
  const requestedTo = parseOptionalDate(body.effectiveTo, "effectiveTo");
  return withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(recipeSellableLinks)
      .where(and(eq(recipeSellableLinks.tenantId, tenantId), eq(recipeSellableLinks.publicId, linkPublicId)))
      .limit(1)
      .for("update");
    if (!row) {
      throw new InventoryError("Link not found.", 404, "link_not_found", "linkPublicId");
    }
    if (row.effectiveTo !== null) {
      throw new InventoryConflictError("This link has already ended. Reload to see the current link.", "link_not_current", "linkPublicId");
    }
    const today = await tenantToday(tx, tenantId, now);
    const effectiveTo = requestedTo ?? (row.effectiveFrom > today ? row.effectiveFrom : today);
    if (effectiveTo < row.effectiveFrom) {
      throw new InventoryError(
        `The end date cannot be earlier than the link's start date (${row.effectiveFrom}).`,
        400,
        "effective_from_before_current",
        "effectiveTo",
      );
    }
    const [ended] = await tx
      .update(recipeSellableLinks)
      .set({ effectiveTo })
      .where(and(eq(recipeSellableLinks.id, row.id), isNull(recipeSellableLinks.effectiveTo)))
      .returning();
    if (!ended) {
      throw new InventoryConflictError("This link has already ended. Reload to see the current link.", "link_not_current", "linkPublicId");
    }
    const [variant] = await tx
      .select({ publicId: catalogueVariants.publicId })
      .from(catalogueVariants)
      .where(and(eq(catalogueVariants.tenantId, tenantId), eq(catalogueVariants.id, row.variantId)))
      .limit(1);
    const variantPublicId = variant?.publicId ?? "";
    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "recipe.link.end",
      entityType: "recipe_sellable_link",
      entityPublicId: ended.publicId,
      entityVersion: ended.revision,
      changeSummary: {
        before: await linkSummary(tx, tenantId, row, variantPublicId),
        after: await linkSummary(tx, tenantId, ended, variantPublicId),
      },
    });
    return loadLinksViewInTx(tx, tenantId, now);
  });
}

