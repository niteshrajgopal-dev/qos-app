import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import {
  ACTOR,
  ADMIN,
  auditActions,
  type IntegrationConnection,
  rejection,
  truncateInventory,
  USER,
} from "@/lib/inventory/integration-helpers";
import { createItem, updateItem } from "@/lib/inventory/items";
import { createSupplier, getSupplier, listSuppliers, updateSupplier } from "@/lib/inventory/suppliers";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const FULL = {
  nameEn: "Gulf Fresh Produce",
  nameAr: "الخليج للمنتجات الطازجة",
  code: "GFP-01",
  contactName: "Sara Haddad",
  phone: "+971 4 555 0101",
  email: "orders@gulf-fresh.ae",
  address: "Warehouse 12, Al Quoz Industrial 3, Dubai",
  notes: "Deliveries before 9 am. Call ahead on Fridays.",
};

integrationDescribe("inventory suppliers service", () => {
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

  it("creates a supplier with every field and reads each one back from list and detail", async () => {
    const created = await createSupplier(db, tenantId, ADMIN, ACTOR, FULL);
    expect(created.supplier.publicId).toMatch(/^sup_gulf-fresh-produce_[0-9a-f]{8}$/);
    expect(created.supplier).toMatchObject({ ...FULL, status: "active", version: 1, provenance: "operator_entered" });
    expect(created.items).toEqual([]);
    expect(created.dependencies).toEqual([]);
    const reloaded = await getSupplier(db, tenantId, created.supplier.publicId);
    expect(reloaded).toEqual(created);
    expect((await listSuppliers(db, tenantId)).suppliers).toEqual([created.supplier]);
    const [row] = await sql<Record<string, unknown>[]>`
      SELECT name_en, name_ar, code, contact_name, phone, email, address, notes, created_by_subject
      FROM qos.inventory_suppliers WHERE public_id = ${created.supplier.publicId}`;
    expect(row).toEqual({
      name_en: FULL.nameEn,
      name_ar: FULL.nameAr,
      code: FULL.code,
      contact_name: FULL.contactName,
      phone: FULL.phone,
      email: FULL.email,
      address: FULL.address,
      notes: FULL.notes,
      created_by_subject: ACTOR,
    });
  });

  it("keeps two suppliers with the same name as two separate suppliers", async () => {
    const first = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Gulf Supply", code: "GS-DXB" });
    const second = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Gulf Supply", code: "GS-AUH" });
    const third = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "gulf supply" });
    expect(new Set([first, second, third].map((entry) => entry.supplier.publicId)).size).toBe(3);
    const listed = (await listSuppliers(db, tenantId)).suppliers;
    expect(listed.map((supplier) => [supplier.nameEn, supplier.code])).toEqual(
      expect.arrayContaining([
        ["Gulf Supply", "GS-DXB"],
        ["Gulf Supply", "GS-AUH"],
        ["gulf supply", null],
      ]),
    );
    expect(listed).toHaveLength(3);
    // Editing one leaves the other untouched.
    await updateSupplier(db, tenantId, ADMIN, ACTOR, first.supplier.publicId, { expectedVersion: 1, phone: "04 111 2222" });
    expect((await getSupplier(db, tenantId, second.supplier.publicId)).supplier).toEqual(second.supplier);
  });

  it("updates only the fields sent, clears optional fields with null or blank and keeps the public id on rename", async () => {
    const created = await createSupplier(db, tenantId, ADMIN, ACTOR, FULL);
    const renamed = await updateSupplier(db, tenantId, ADMIN, ACTOR, created.supplier.publicId, {
      expectedVersion: 1,
      nameEn: "Gulf Fresh",
      phone: null,
      email: "",
      code: "gfp-02",
    });
    expect(renamed.supplier).toMatchObject({
      publicId: created.supplier.publicId,
      nameEn: "Gulf Fresh",
      nameAr: FULL.nameAr,
      code: "gfp-02",
      contactName: FULL.contactName,
      phone: null,
      email: null,
      address: FULL.address,
      notes: FULL.notes,
      version: 2,
    });
    expect(await getSupplier(db, tenantId, created.supplier.publicId)).toEqual(renamed);
    const audit = (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_supplier");
    expect(audit.map((row) => row.action)).toEqual(["inventory.supplier.create", "inventory.supplier.update"]);
    expect(audit[1]!.change_summary).toMatchObject({
      before: { nameEn: FULL.nameEn, phone: FULL.phone, email: FULL.email, code: "GFP-01" },
      after: { nameEn: "Gulf Fresh", phone: null, email: null, code: "gfp-02", address: FULL.address },
    });
  });

  it("answers 409 when a reference code is taken, compared without case", async () => {
    const first = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Gulf Supply", code: "GS-1" });
    expect(await rejection(createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Other", code: "gs-1" }))).toEqual({
      statusCode: 409,
      code: "supplier_code_taken",
      field: "code",
    });
    const second = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Other" });
    expect(
      await rejection(updateSupplier(db, tenantId, ADMIN, ACTOR, second.supplier.publicId, { expectedVersion: 1, code: "GS-1" })),
    ).toMatchObject({ statusCode: 409, code: "supplier_code_taken" });
    // Re-saving a supplier's own code is not a conflict.
    const same = await updateSupplier(db, tenantId, ADMIN, ACTOR, first.supplier.publicId, { expectedVersion: 1, code: "GS-1" });
    expect(same.supplier.code).toBe("GS-1");
  });

  it("refuses to archive a supplier used by active items, explaining the dependency, then archives and restores it", async () => {
    const supplier = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Gulf Supply" });
    const milk = await createItem(db, tenantId, ADMIN, ACTOR, {
      nameEn: "Milk",
      kind: "purchased",
      defaultSupplierPublicId: supplier.supplier.publicId,
    });
    const flour = await createItem(db, tenantId, ADMIN, ACTOR, {
      nameEn: "Flour",
      kind: "purchased",
      defaultSupplierPublicId: supplier.supplier.publicId,
    });
    const detail = await getSupplier(db, tenantId, supplier.supplier.publicId);
    expect(detail.items.map((item) => item.nameEn)).toEqual(["Flour", "Milk"]);
    expect(detail.dependencies).toEqual([{ kind: "inventory_items", count: 2 }]);

    let refused: unknown;
    try {
      await updateSupplier(db, tenantId, ADMIN, ACTOR, supplier.supplier.publicId, { expectedVersion: 1, status: "archived" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({
      statusCode: 409,
      code: "supplier_in_use",
      field: "status",
      dependencies: [{ kind: "inventory_items", count: 2 }],
    });
    expect((await getSupplier(db, tenantId, supplier.supplier.publicId)).supplier).toMatchObject({ status: "active", version: 1 });

    // An archived item keeps its default as history and does not block.
    await updateItem(db, tenantId, ADMIN, ACTOR, milk.item.publicId, { expectedVersion: 1, status: "archived" });
    await updateItem(db, tenantId, ADMIN, ACTOR, flour.item.publicId, { expectedVersion: 1, defaultSupplierPublicId: null });
    const archived = await updateSupplier(db, tenantId, ADMIN, ACTOR, supplier.supplier.publicId, {
      expectedVersion: 1,
      status: "archived",
    });
    expect(archived.supplier.status).toBe("archived");
    expect(archived.items.map((item) => [item.nameEn, item.status])).toEqual([["Milk", "archived"]]);
    const restored = await updateSupplier(db, tenantId, ADMIN, ACTOR, supplier.supplier.publicId, {
      expectedVersion: 2,
      status: "active",
    });
    expect(restored.supplier).toMatchObject({ status: "active", version: 3 });
    expect(
      (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_supplier").map((row) => row.action),
    ).toEqual(["inventory.supplier.create", "inventory.supplier.archive", "inventory.supplier.restore"]);
  });

  it("validates every field and writes nothing on a 400", async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ nameEn: " " }, "name_required", "nameEn"],
      [{ nameEn: "x".repeat(121) }, "name_too_long", "nameEn"],
      [{ nameEn: "A", nameAr: "ب".repeat(121) }, "name_too_long", "nameAr"],
      [{ nameEn: "A", code: "has space" }, "code_invalid", "code"],
      [{ nameEn: "A", contactName: "x".repeat(121) }, "text_too_long", "contactName"],
      [{ nameEn: "A", phone: "call me" }, "phone_invalid", "phone"],
      [{ nameEn: "A", email: "not-an-email" }, "email_invalid", "email"],
      [{ nameEn: "A", address: "x".repeat(401) }, "text_too_long", "address"],
      [{ nameEn: "A", notes: "x".repeat(1001) }, "text_too_long", "notes"],
    ];
    for (const [body, code, field] of cases) {
      expect(await rejection(createSupplier(db, tenantId, ADMIN, ACTOR, body)), code).toEqual({ statusCode: 400, code, field });
    }
    expect(await rejection(createSupplier(db, tenantId, ADMIN, ACTOR, ["not", "an", "object"]))).toMatchObject({
      statusCode: 400,
      code: "body_invalid",
    });
    const created = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Valid" });
    expect(
      await rejection(updateSupplier(db, tenantId, ADMIN, ACTOR, created.supplier.publicId, { expectedVersion: 1, status: "deleted" })),
    ).toMatchObject({ statusCode: 400, code: "status_invalid" });
    expect(await rejection(updateSupplier(db, tenantId, ADMIN, ACTOR, created.supplier.publicId, { nameEn: "B" }))).toMatchObject({
      statusCode: 400,
      code: "expected_version_required",
    });
    expect((await listSuppliers(db, tenantId)).suppliers).toHaveLength(1);
  });

  it("answers 409 on a stale version and 403 for a user-role member, writing nothing", async () => {
    const created = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Gulf Supply" });
    await updateSupplier(db, tenantId, ADMIN, ACTOR, created.supplier.publicId, { expectedVersion: 1, notes: "First" });
    expect(
      await rejection(updateSupplier(db, tenantId, ADMIN, ACTOR, created.supplier.publicId, { expectedVersion: 1, notes: "Second" })),
    ).toMatchObject({ statusCode: 409, code: "expected_version_mismatch" });
    expect(await rejection(createSupplier(db, tenantId, USER, ACTOR, { nameEn: "Sneaky" }))).toMatchObject({
      statusCode: 403,
      code: "administrator_required",
    });
    expect(
      await rejection(updateSupplier(db, tenantId, USER, ACTOR, created.supplier.publicId, { expectedVersion: 2, notes: "User" })),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    const after = await getSupplier(db, tenantId, created.supplier.publicId);
    expect(after.supplier).toMatchObject({ notes: "First", version: 2 });
    expect((await listSuppliers(db, tenantId)).suppliers).toHaveLength(1);
  });

  it("isolates tenants: another tenant's supplier is 404 and never listed", async () => {
    const created = await createSupplier(db, tenantId, ADMIN, ACTOR, { nameEn: "Gulf Supply", code: "GS-1" });
    const other = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    expect(await rejection(getSupplier(db, other, created.supplier.publicId))).toEqual({
      statusCode: 404,
      code: "supplier_not_found",
      field: "supplierPublicId",
    });
    expect(
      await rejection(updateSupplier(db, other, ADMIN, ACTOR, created.supplier.publicId, { expectedVersion: 1, nameEn: "Taken" })),
    ).toMatchObject({ statusCode: 404, code: "supplier_not_found" });
    expect((await listSuppliers(db, other)).suppliers).toEqual([]);
    // Codes are unique per tenant only.
    const otherSupplier = await createSupplier(db, other, ADMIN, ACTOR, { nameEn: "Gulf Supply", code: "GS-1" });
    expect(otherSupplier.supplier.publicId).not.toBe(created.supplier.publicId);
    expect((await getSupplier(db, tenantId, created.supplier.publicId)).supplier.nameEn).toBe("Gulf Supply");
  });
});
