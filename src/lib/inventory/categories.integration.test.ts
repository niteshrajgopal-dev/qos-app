import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createCategory, getCategory, listCategories, updateCategory } from "@/lib/inventory/categories";
import {
  ACTOR,
  ADMIN,
  auditActions,
  type IntegrationConnection,
  rejection,
  truncateInventory,
  USER,
} from "@/lib/inventory/integration-helpers";
import { createItem, getItem, listItems, updateItem } from "@/lib/inventory/items";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("inventory categories service", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;

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
  });

  it("creates a category with both names and reads every field back from list and detail", async () => {
    const created = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "  Dairy ", nameAr: "ألبان" });
    expect(created.category.publicId).toMatch(/^invcat_dairy_[0-9a-f]{8}$/);
    expect(created.category).toMatchObject({ nameEn: "Dairy", nameAr: "ألبان", status: "active", version: 1, provenance: "operator_entered" });
    expect(created.items).toEqual([]);
    expect(created.dependencies).toEqual([]);
    expect(await getCategory(db, tenantId, created.category.publicId)).toEqual(created);
    expect((await listCategories(db, tenantId)).categories).toEqual([{ ...created.category, itemCount: 0, activeItemCount: 0 }]);
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT name_en, name_ar, status, version, created_by_subject, updated_by_subject
      FROM qos.inventory_categories WHERE public_id = ${created.category.publicId}`;
    expect(row).toEqual({
      name_en: "Dairy",
      name_ar: "ألبان",
      status: "active",
      version: 1,
      created_by_subject: ACTOR,
      updated_by_subject: ACTOR,
    });
    const audit = await auditActions(sql, tenantId);
    expect(audit).toEqual([
      expect.objectContaining({
        action: "inventory.category.create",
        entity_type: "inventory_category",
        entity_public_id: created.category.publicId,
        change_summary: { after: { nameEn: "Dairy", nameAr: "ألبان", status: "active" } },
      }),
    ]);
  });

  it("renames a category without changing its identity or its items' links", async () => {
    const dairy = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Dairy" });
    const milk = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Milk", kind: "purchased", categoryPublicId: dairy.category.publicId });
    const renamed = await updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, {
      expectedVersion: 1,
      nameEn: "Dairy and eggs",
      nameAr: "ألبان وبيض",
    });
    expect(renamed.category).toMatchObject({ publicId: dairy.category.publicId, nameEn: "Dairy and eggs", nameAr: "ألبان وبيض", version: 2 });
    expect(renamed.items.map((item) => item.publicId)).toEqual([milk.item.publicId]);
    expect((await getItem(db, tenantId, milk.item.publicId)).item.categoryPublicId).toBe(dairy.category.publicId);
    const cleared = await updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 2, nameAr: "" });
    expect(cleared.category.nameAr).toBeNull();
    const audit = (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_category");
    expect(audit.map((row) => row.action)).toEqual(["inventory.category.create", "inventory.category.update", "inventory.category.update"]);
    expect(audit[1]!.change_summary).toEqual({
      before: { nameEn: "Dairy", nameAr: null, status: "active" },
      after: { nameEn: "Dairy and eggs", nameAr: "ألبان وبيض", status: "active" },
    });
  });

  it("refuses a second active category with the same English name and allows it once the first is archived", async () => {
    const dairy = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Dairy" });
    expect(await rejection(createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: " DAIRY " }))).toEqual({
      statusCode: 409,
      code: "category_name_taken",
      field: "nameEn",
    });
    const produce = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Produce" });
    expect(
      await rejection(updateCategory(db, tenantId, ADMIN, ACTOR, produce.category.publicId, { expectedVersion: 1, nameEn: "dairy" })),
    ).toMatchObject({ statusCode: 409, code: "category_name_taken" });
    await updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 1, status: "archived" });
    const second = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Dairy" });
    expect(second.category.publicId).not.toBe(dairy.category.publicId);
    // Restoring the archived one would make two active "Dairy" rows: refused.
    expect(
      await rejection(updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 2, status: "active" })),
    ).toMatchObject({ statusCode: 409, code: "category_name_taken" });
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM qos.inventory_categories WHERE status = 'active'`;
    expect(count).toBe(2);
  });

  it("refuses to archive while active items use the category, lists them, and archives once they moved; restore works", async () => {
    const dairy = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Dairy" });
    const pantry = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Pantry" });
    const milk = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Milk", kind: "purchased", categoryPublicId: dairy.category.publicId });
    const cheese = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Cheese", kind: "purchased", categoryPublicId: dairy.category.publicId });
    await updateItem(db, tenantId, ADMIN, ACTOR, cheese.item.publicId, { expectedVersion: 1, status: "archived" });

    const detail = await getCategory(db, tenantId, dairy.category.publicId);
    expect(detail.items.map((item) => [item.nameEn, item.status])).toEqual([
      ["Cheese", "archived"],
      ["Milk", "active"],
    ]);
    expect(detail.dependencies).toEqual([{ kind: "inventory_items", count: 1 }]);
    expect((await listCategories(db, tenantId)).categories.find((entry) => entry.publicId === dairy.category.publicId)).toMatchObject({
      itemCount: 2,
      activeItemCount: 1,
    });

    let refused: unknown;
    try {
      await updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 1, status: "archived" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({
      statusCode: 409,
      code: "category_in_use",
      field: "status",
      dependencies: [{ kind: "inventory_items", count: 1 }],
    });
    expect((await getCategory(db, tenantId, dairy.category.publicId)).category).toMatchObject({ status: "active", version: 1 });

    await updateItem(db, tenantId, ADMIN, ACTOR, milk.item.publicId, { expectedVersion: 1, categoryPublicId: pantry.category.publicId });
    const archived = await updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 1, status: "archived" });
    expect(archived.category).toMatchObject({ status: "archived", version: 2 });
    // The archived item keeps the archived category as history.
    expect(archived.items.map((item) => item.publicId)).toEqual([cheese.item.publicId]);
    expect((await getItem(db, tenantId, cheese.item.publicId)).item.categoryPublicId).toBe(dairy.category.publicId);

    const restored = await updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 2, status: "active" });
    expect(restored.category).toMatchObject({ status: "active", version: 3 });
    const actions = (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_category").map((row) => row.action);
    expect(actions).toEqual([
      "inventory.category.create",
      "inventory.category.create",
      "inventory.category.archive",
      "inventory.category.restore",
    ]);
  });

  it("refuses invalid input and stale versions without writing anything", async () => {
    expect(await rejection(createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "" }))).toEqual({
      statusCode: 400,
      code: "name_required",
      field: "nameEn",
    });
    expect(await rejection(createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "x".repeat(121) }))).toMatchObject({ code: "name_too_long" });
    expect(await rejection(createCategory(db, tenantId, ADMIN, ACTOR, null))).toMatchObject({ statusCode: 400, code: "body_invalid" });
    const dairy = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Dairy" });
    expect(
      await rejection(updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 5, nameEn: "Stale" })),
    ).toEqual({ statusCode: 409, code: "expected_version_mismatch", field: "expectedVersion" });
    expect(await rejection(updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { nameEn: "No version" }))).toMatchObject({
      statusCode: 400,
      code: "expected_version_required",
    });
    expect(
      await rejection(updateCategory(db, tenantId, ADMIN, ACTOR, dairy.category.publicId, { expectedVersion: 1, status: "deleted" })),
    ).toMatchObject({ statusCode: 400, code: "status_invalid" });
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM qos.inventory_categories`;
    expect(count).toBe(1);
    expect((await getCategory(db, tenantId, dairy.category.publicId)).category).toMatchObject({ nameEn: "Dairy", version: 1 });
    expect((await auditActions(sql, tenantId)).map((row) => row.action)).toEqual(["inventory.category.create"]);
  });

  it("answers 403 to a user-role member on every write and lets them read", async () => {
    const dairy = await createCategory(db, tenantId, ADMIN, ACTOR, { nameEn: "Dairy" });
    expect(await rejection(createCategory(db, tenantId, USER, ACTOR, { nameEn: "Produce" }))).toMatchObject({
      statusCode: 403,
      code: "administrator_required",
    });
    expect(
      await rejection(updateCategory(db, tenantId, USER, ACTOR, dairy.category.publicId, { expectedVersion: 1, status: "archived" })),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    expect((await listCategories(db, tenantId)).categories).toHaveLength(1);
    expect((await getCategory(db, tenantId, dairy.category.publicId)).category.status).toBe("active");
  });

  it("isolates tenants: another business's category is not listed, not found and cannot be assigned", async () => {
    const otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    const foreign = await createCategory(db, otherTenantId, ADMIN, ACTOR, { nameEn: "Flowers" });
    expect((await listCategories(db, tenantId)).categories).toEqual([]);
    expect(await rejection(getCategory(db, tenantId, foreign.category.publicId))).toEqual({
      statusCode: 404,
      code: "category_not_found",
      field: "categoryPublicId",
    });
    expect(
      await rejection(updateCategory(db, tenantId, ADMIN, ACTOR, foreign.category.publicId, { expectedVersion: 1, nameEn: "Hijack" })),
    ).toMatchObject({ statusCode: 404, code: "category_not_found" });
    expect(
      await rejection(createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Rose", kind: "purchased", categoryPublicId: foreign.category.publicId })),
    ).toEqual({ statusCode: 404, code: "category_not_found", field: "categoryPublicId" });
    expect((await listItems(db, tenantId)).items).toEqual([]);
    expect((await getCategory(db, otherTenantId, foreign.category.publicId)).category).toMatchObject({ nameEn: "Flowers", version: 1 });
  });
});
