import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DbClient } from "@/db/client";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { listProductVariants, updateProductVariant } from "@/lib/catalogue/variants";
import { ACTOR, ADMIN, auditActions, type IntegrationConnection, truncateInventory } from "@/lib/inventory/integration-helpers";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createSellableLink } from "@/lib/recipes/links";
import { createRecipe } from "@/lib/recipes/recipes";
import { withTenantContext } from "@/lib/tenant/context";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { applyVariants } from "@/lib/workbook/apply/handlers/variants";
import type { ApplyRuntime } from "@/lib/workbook/apply/handlers/types";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";

/* A workbook row that sets an archived variant back to active goes through
   the restore service: non-default, audited as a restore, link untouched.
   Other fields on the same row still apply through the variant update. */

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("workbook variant restore", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
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
    fx = await seedRecipeFixtures(db, tenantId);
    const recipe = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" });
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: recipe.recipe.publicId });
    const view = await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId);
    await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.large, { expectedProductVersion: view.productVersion, status: "archived" }, ACTOR);
  });

  async function applyRow(changes: Array<{ column: string; before: string | null; after: string | null }>) {
    const [{ brand_id: brandId }] = await sql<{ brand_id: string }[]>`
      SELECT brand_id FROM qos.catalogue_products WHERE public_id = ${fx.latte.productPublicId}`;
    const run = {
      tenantId,
      membership: ADMIN,
      actor: { subject: ACTOR, role: "administrator" },
      plan: { brandId },
      snapshot: { records: { Products: new Set([fx.latte.productPublicId]) }, permittedBranches: new Set() },
      rowsByKey: new Map(),
      saved: new Map(),
    } as unknown as ApplyRuntime;
    const row = {
      id: "row-1",
      sheet: "Variants",
      row: 6,
      operation: "restore",
      targetPublicId: fx.latte.large,
      before: { product_key: fx.latte.productPublicId, status: "archived" },
      after: { product_key: fx.latte.productPublicId, status: "active" },
      changes,
    } as unknown as PlanRowRecord;
    return withTenantContext(db, tenantId, (tx) =>
      applyVariants({ tx, db: tx as unknown as DbClient, run, guard: { enter: async () => {} } }, { sheet: "Variants", rows: [row] }),
    );
  }

  const large = async () =>
    (await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId)).variants.find((variant) => variant.publicId === fx.latte.large)!;

  it("restores through the restore service and records a restore, not a generic update", async () => {
    const linkBefore = await sql`SELECT public_id, effective_to, revision FROM qos.recipe_sellable_links`;
    const before = (await auditActions(sql, tenantId)).length;

    await applyRow([{ column: "status", before: "archived", after: "active" }]);

    expect(await large()).toMatchObject({ status: "active", isDefault: false, sellableLinkKind: "recipe" });
    expect(await sql`SELECT public_id, effective_to, revision FROM qos.recipe_sellable_links`).toEqual(linkBefore);
    const added = (await auditActions(sql, tenantId)).slice(before).map((event) => event.action);
    expect(added).toEqual(["catalogue.variant.restore"]);
  });

  it("applies the row's other fields after the restore", async () => {
    await applyRow([
      { column: "status", before: "archived", after: "active" },
      { column: "variant_label_en", before: "Large", after: "Big" },
    ]);

    const restored = await large();
    expect(restored).toMatchObject({ status: "active", isDefault: false });
    expect(restored.translations.en.displayName).toBe("Big");
    // Both events share the unit's transaction timestamp, so compare them unordered.
    const events = (await auditActions(sql, tenantId)).filter((event) => event.entity_public_id === fx.latte.large);
    const added = events.slice(events.findIndex((event) => event.action === "catalogue.variant.archive") + 1);
    expect(added.map((event) => event.action).sort()).toEqual(["catalogue.variant.restore", "catalogue.variant.update"]);
  });
});
