import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { archiveDraftProduct, createDraftProduct } from "@/lib/catalogue/products";
import { CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE } from "@/lib/catalogue/product-mutation-policy";
import {
  CATALOGUE_VARIANT_RESTORE_CODES,
  createProductVariant,
  listProductVariants,
  restoreArchivedVariant,
  updateProductVariant,
} from "@/lib/catalogue/variants";
import { ACTOR, ADMIN, auditActions, type IntegrationConnection, rejection, truncateInventory, USER } from "@/lib/inventory/integration-helpers";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createSellableLink, listSellableLinks } from "@/lib/recipes/links";
import { createRecipe } from "@/lib/recipes/recipes";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

/* Restoring an archived variant: back to active, never the default, at the
   end of the active order, with its recipe or direct-stock link, prices and
   translations untouched, and one catalogue.variant.restore audit event
   written in the same transaction as the status change. */

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("restoreArchivedVariant", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let otherTenantId: string;
  let fx: RecipeFixtures;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await truncateInventory(sql);
    tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    fx = await seedRecipeFixtures(db, tenantId);
  });

  const variants = (productPublicId: string, tenant = tenantId) => listProductVariants(db, tenant, ADMIN, productPublicId);
  const find = (view: Awaited<ReturnType<typeof variants>>, publicId: string) =>
    view.variants.find((variant) => variant.publicId === publicId)!;

  async function archive(productPublicId: string, variantPublicId: string) {
    const view = await variants(productPublicId);
    return updateProductVariant(db, tenantId, ADMIN, productPublicId, variantPublicId, { expectedProductVersion: view.productVersion, status: "archived" }, ACTOR);
  }

  async function restore(productPublicId: string, variantPublicId: string, expectedProductVersion?: number, tenant = tenantId) {
    const version = expectedProductVersion ?? (await variants(productPublicId)).productVersion;
    return restoreArchivedVariant(db, tenant, ADMIN, productPublicId, variantPublicId, { expectedProductVersion: version }, ACTOR);
  }

  async function linkRows(variantPublicId: string) {
    return sql<{ public_id: string; kind: string; recipe_id: string | null; item_id: string | null; quantity_micros: string | null; effective_from: string; effective_to: string | null; revision: number }[]>`
      SELECT l.public_id, l.kind, l.recipe_id, l.item_id, l.quantity_micros::text, l.effective_from::text, l.effective_to::text, l.revision
      FROM qos.recipe_sellable_links l JOIN qos.catalogue_variants v ON v.id = l.variant_id
      WHERE v.public_id = ${variantPublicId} ORDER BY l.revision`;
  }

  async function sideData(variantPublicId: string) {
    const prices = await sql`
      SELECT p.amount_minor, p.currency, p.version FROM qos.catalogue_variant_prices p
      JOIN qos.catalogue_variants v ON v.id = p.variant_id WHERE v.public_id = ${variantPublicId}`;
    const translations = await sql`
      SELECT t.locale, t.display_name FROM qos.catalogue_variant_translations t
      JOIN qos.catalogue_variants v ON v.id = t.variant_id WHERE v.public_id = ${variantPublicId} ORDER BY t.locale`;
    return { prices, translations };
  }

  async function linkRecipe(variantPublicId: string) {
    const recipe = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" });
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId, kind: "recipe", recipePublicId: recipe.recipe.publicId });
  }

  it("restores an archived recipe-linked variant to active, non-default, and leaves its link, price and labels as they were", async () => {
    await linkRecipe(fx.latte.large);
    const archived = await archive(fx.latte.productPublicId, fx.latte.large);
    expect(find(archived, fx.latte.large)).toMatchObject({ status: "archived", isDefault: false, sellableLinkKind: "recipe" });
    const archivedRow = (await listSellableLinks(db, tenantId)).variants.find((row) => row.variantPublicId === fx.latte.large)!;
    expect(archivedRow.states).toContain("variant_archived");

    const linksBefore = await linkRows(fx.latte.large);
    const dataBefore = await sideData(fx.latte.large);
    expect(linksBefore).toHaveLength(1);

    const restored = await restore(fx.latte.productPublicId, fx.latte.large);

    expect(restored.productVersion).toBe(archived.productVersion + 1);
    expect(find(restored, fx.latte.large)).toMatchObject({ status: "active", isDefault: false, sellableLinkKind: "recipe" });
    expect(find(restored, fx.latte.regular).isDefault).toBe(true);
    expect(await linkRows(fx.latte.large)).toEqual(linksBefore);
    expect(linksBefore[0]).toMatchObject({ kind: "recipe", effective_to: null, revision: 1 });
    expect(await sideData(fx.latte.large)).toEqual(dataBefore);

    const restoredRow = (await listSellableLinks(db, tenantId)).variants.find((row) => row.variantPublicId === fx.latte.large)!;
    expect(restoredRow.variantStatus).toBe("active");
    expect(restoredRow.states).not.toContain("variant_archived");
    expect(restoredRow.link).toMatchObject({ kind: "recipe", effectiveTo: null });
  });

  it("restores a direct-stock-linked variant with the same link row, quantity and unit", async () => {
    const water = await variants(fx.water.productPublicId);
    const labelled = await updateProductVariant(
      db,
      tenantId,
      ADMIN,
      fx.water.productPublicId,
      fx.water.variant,
      { expectedProductVersion: water.productVersion, translations: { en: { displayName: "Small bottle" }, ar: { displayName: "زجاجة صغيرة" } } },
      ACTOR,
    );
    await createProductVariant(
      db,
      tenantId,
      ADMIN,
      fx.water.productPublicId,
      {
        expectedProductVersion: labelled.productVersion,
        publicId: "var_water_large",
        translations: { en: { displayName: "Large bottle" }, ar: { displayName: "زجاجة كبيرة" } },
        amountMinor: 800,
      },
      ACTOR,
    );
    await createSellableLink(db, tenantId, ADMIN, ACTOR, {
      variantPublicId: "var_water_large",
      kind: "direct_stock",
      itemPublicId: fx.items.water,
      quantity: "2",
      unitPublicId: fx.units.bottle,
    });
    await archive(fx.water.productPublicId, "var_water_large");
    const linksBefore = await linkRows("var_water_large");

    const restored = await restore(fx.water.productPublicId, "var_water_large");

    expect(find(restored, "var_water_large")).toMatchObject({ status: "active", isDefault: false, sellableLinkKind: "direct_stock" });
    expect(await linkRows("var_water_large")).toEqual(linksBefore);
    expect(linksBefore).toEqual([expect.objectContaining({ kind: "direct_stock", quantity_micros: "2000000", effective_to: null })]);
  });

  it("writes one catalogue.variant.restore audit event in the same transaction as the status change", async () => {
    await archive(fx.latte.productPublicId, fx.latte.large);
    const restored = await restore(fx.latte.productPublicId, fx.latte.large);

    const events = (await auditActions(sql, tenantId)).filter((event) => event.action === "catalogue.variant.restore");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entity_type: "catalogue_variant",
      entity_public_id: fx.latte.large,
      change_summary: {
        productPublicId: fx.latte.productPublicId,
        before: { status: "archived", isDefault: false },
        after: { status: "active", isDefault: false },
      },
    });
    // xmin is the id of the transaction that last wrote the row.
    const [{ same, version }] = await sql<{ same: boolean; version: number }[]>`
      SELECT (SELECT xmin::text FROM qos.catalogue_variants WHERE public_id = ${fx.latte.large})
           = (SELECT xmin::text FROM qos.tenant_audit_events WHERE action = 'catalogue.variant.restore') AS same,
             (SELECT entity_version FROM qos.tenant_audit_events WHERE action = 'catalogue.variant.restore') AS version`;
    expect(same).toBe(true);
    expect(version).toBe(restored.productVersion);
  });

  it("puts the restored variant at the end of the active order so reordering still covers every active variant", async () => {
    await archive(fx.latte.productPublicId, fx.latte.large);
    const view = await variants(fx.latte.productPublicId);
    const withMedium = await createProductVariant(
      db,
      tenantId,
      ADMIN,
      fx.latte.productPublicId,
      { expectedProductVersion: view.productVersion, publicId: "var_latte_medium", translations: { en: { displayName: "Medium" }, ar: { displayName: "وسط" } } },
      ACTOR,
    );
    const restored = await restore(fx.latte.productPublicId, fx.latte.large, withMedium.productVersion);
    const active = restored.variants.filter((variant) => variant.status === "active");
    expect(active.map((variant) => variant.publicId)).toEqual([fx.latte.regular, "var_latte_medium", fx.latte.large]);
    expect(new Set(active.map((variant) => variant.sortOrder)).size).toBe(3);
  });

  it("brings back a former default as a non-default variant and keeps the current default", async () => {
    let view = await variants(fx.latte.productPublicId);
    view = await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.large, { expectedProductVersion: view.productVersion, isDefault: true }, ACTOR);
    expect(find(view, fx.latte.regular).isDefault).toBe(false);
    await archive(fx.latte.productPublicId, fx.latte.regular);

    const restored = await restore(fx.latte.productPublicId, fx.latte.regular);

    expect(find(restored, fx.latte.regular)).toMatchObject({ status: "active", isDefault: false });
    expect(find(restored, fx.latte.large)).toMatchObject({ status: "active", isDefault: true });
    expect(restored.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
  });

  it("still refuses to archive the default variant and the last active variant", async () => {
    const view = await variants(fx.latte.productPublicId);
    expect(
      await rejection(
        updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.regular, { expectedProductVersion: view.productVersion, status: "archived" }, ACTOR),
      ),
    ).toMatchObject({ statusCode: 400, field: "status" });
    const water = await variants(fx.water.productPublicId);
    await expect(
      updateProductVariant(db, tenantId, ADMIN, fx.water.productPublicId, fx.water.variant, { expectedProductVersion: water.productVersion, status: "archived" }, ACTOR),
    ).rejects.toThrow("A product must keep at least one active variant.");
    expect(find(await variants(fx.latte.productPublicId), fx.latte.regular).status).toBe("active");
    expect(find(await variants(fx.water.productPublicId), fx.water.variant).status).toBe("active");
  });

  it("refuses to restore an active variant, a missing variant or another tenant's variant", async () => {
    expect(await rejection(restore(fx.latte.productPublicId, fx.latte.large))).toMatchObject({
      statusCode: 409,
      code: CATALOGUE_VARIANT_RESTORE_CODES.NOT_ARCHIVED,
    });
    expect(await rejection(restore(fx.latte.productPublicId, "var_missing"))).toMatchObject({ statusCode: 404 });

    await archive(fx.latte.productPublicId, fx.latte.large);
    const version = (await variants(fx.latte.productPublicId)).productVersion;
    expect(await rejection(restore(fx.latte.productPublicId, fx.latte.large, version, otherTenantId))).toMatchObject({ statusCode: 404 });
    expect(find(await variants(fx.latte.productPublicId), fx.latte.large).status).toBe("archived");
  });

  it("refuses a stale product version and writes nothing", async () => {
    const archived = await archive(fx.latte.productPublicId, fx.latte.large);
    expect(await rejection(restore(fx.latte.productPublicId, fx.latte.large, archived.productVersion - 1))).toMatchObject({
      statusCode: 409,
      field: "expectedProductVersion",
    });
    expect(await rejection(restoreArchivedVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.large, {} as never, ACTOR))).toMatchObject({
      statusCode: 400,
      field: "expectedProductVersion",
    });
    const view = await variants(fx.latte.productPublicId);
    expect(view.productVersion).toBe(archived.productVersion);
    expect(find(view, fx.latte.large).status).toBe("archived");
    expect((await auditActions(sql, tenantId)).map((event) => event.action)).not.toContain("catalogue.variant.restore");
  });

  it("is administrator-only", async () => {
    const archived = await archive(fx.latte.productPublicId, fx.latte.large);
    expect(
      await rejection(restoreArchivedVariant(db, tenantId, USER, fx.latte.productPublicId, fx.latte.large, { expectedProductVersion: archived.productVersion }, ACTOR)),
    ).toMatchObject({ statusCode: 403 });
    expect(find(await variants(fx.latte.productPublicId), fx.latte.large).status).toBe("archived");
  });

  it("follows the archived-product refusal used by other variant changes", async () => {
    await archive(fx.latte.productPublicId, fx.latte.large);
    await archiveDraftProduct(db, tenantId, fx.latte.productPublicId, ACTOR);
    expect(await rejection(restore(fx.latte.productPublicId, fx.latte.large))).toMatchObject({
      statusCode: 409,
      code: CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    });
  });

  it("refuses a restore that would duplicate an active variant's label", async () => {
    const archived = await archive(fx.latte.productPublicId, fx.latte.large);
    await createProductVariant(
      db,
      tenantId,
      ADMIN,
      fx.latte.productPublicId,
      { expectedProductVersion: archived.productVersion, translations: { en: { displayName: "Large" }, ar: { displayName: "كبير" } } },
      ACTOR,
    );
    expect(await rejection(restore(fx.latte.productPublicId, fx.latte.large))).toMatchObject({ statusCode: 400 });
    expect(find(await variants(fx.latte.productPublicId), fx.latte.large).status).toBe("archived");
  });

  it("keeps restore off the generic update: status active on an archived variant is refused, unaudited and unchanged", async () => {
    const archived = await archive(fx.latte.productPublicId, fx.latte.large);
    expect(
      await rejection(
        updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.large, { expectedProductVersion: archived.productVersion, status: "active" }, ACTOR),
      ),
    ).toMatchObject({ statusCode: 409, code: CATALOGUE_VARIANT_RESTORE_CODES.RESTORE_REQUIRED, field: "status" });
    const view = await variants(fx.latte.productPublicId);
    expect(view.productVersion).toBe(archived.productVersion);
    expect(find(view, fx.latte.large).status).toBe("archived");

    // Sending status active for a variant that is already active stays a plain update.
    const saved = await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.regular, { expectedProductVersion: view.productVersion, status: "active" }, ACTOR);
    expect(find(saved, fx.latte.regular).status).toBe("active");
  });

  it("reports no link kind for an unlinked variant and does not see another tenant's product", async () => {
    expect(find(await variants(fx.latte.productPublicId), fx.latte.large).sellableLinkKind).toBeNull();
    const product = await createDraftProduct(db, otherTenantId, ADMIN, {
      internalName: "other",
      translations: { en: { displayName: "Other", description: null }, ar: { displayName: "آخر", description: null } },
      defaultVariant: { amountMinor: 100, currency: "AED" },
    });
    expect(await rejection(variants(product.publicId))).toMatchObject({ statusCode: 404 });
  });
});
