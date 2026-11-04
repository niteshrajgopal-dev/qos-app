import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogueMenuLiveRevisions, staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const SCRIPT_DIR = path.join(process.cwd(), "scripts/data/2026-11-quotes-catalogue-cleanup");
const APPLY_SQL = readFileSync(path.join(SCRIPT_DIR, "apply.sql"), "utf8");
const ROLLBACK_SQL = readFileSync(path.join(SCRIPT_DIR, "rollback.sql"), "utf8");

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("quotes-catalogue-cleanup-2026-11 data script (local DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdmin(tenantId: string, subject: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    return {
      membershipId: membership!.id,
      role: "administrator" as const,
      staffIdentityId: identity!.id,
    };
  }

  /** Mirrors the dev Quotes rows QA reported, plus look-alikes that must survive. */
  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedAdmin(quotes.tenant.id, "admin.cleanup@test");
    const flowerAdmin = await seedAdmin(flowers.tenant.id, "admin.flowers-cleanup@test");

    async function product(
      tenantId: string,
      actor: typeof admin,
      internalName: string,
      name: string,
      options: { status?: "draft" | "active"; createdAt: string },
    ) {
      const created = await createDraftProduct(db, tenantId, actor, {
        internalName,
        translations: {
          en: { displayName: name, description: null },
          ar: { displayName: name, description: null },
        },
        defaultVariant: { amountMinor: 1500, currency: "AED" },
      });
      await sqlClient`UPDATE qos.catalogue_products SET status = ${options.status ?? "draft"}, created_at = ${options.createdAt} WHERE public_id = ${created.publicId}`;
      return created.publicId;
    }

    const ids = {
      formula: await product(quotes.tenant.id, admin, "sum-test", "'=SUM(1,2)", { createdAt: "2026-10-20" }),
      espressoOriginal: await product(quotes.tenant.id, admin, "single-espresso", "Single Espresso", {
        createdAt: "2026-09-01",
      }),
      espressoLive: await product(quotes.tenant.id, admin, "single-espresso-2", "single espresso ", {
        status: "active",
        createdAt: "2026-10-01",
      }),
      flatWhite: await product(quotes.tenant.id, admin, "flat-white", "Flat White", { createdAt: "2026-09-01" }),
      flatwhite: await product(quotes.tenant.id, admin, "flatwhite", "Flatwhite", { createdAt: "2026-10-01" }),
      espressoDouble: await product(quotes.tenant.id, admin, "double-espresso", "Single Espresso Double", {
        createdAt: "2026-09-01",
      }),
      flowersEspressoA: await product(flowers.tenant.id, flowerAdmin, "single-espresso", "Single Espresso", {
        createdAt: "2026-09-01",
      }),
      flowersEspressoB: await product(flowers.tenant.id, flowerAdmin, "single-espresso-b", "Single Espresso", {
        createdAt: "2026-10-01",
      }),
      flowersFormula: await product(flowers.tenant.id, flowerAdmin, "sum", "=SUM(1,2)", { createdAt: "2026-09-01" }),
    };

    // Flatwhite sits in a draft menu; the newer espresso is in a published revision.
    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "فطور" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
          products: [{ productPublicId: ids.flatwhite, sortOrder: 0 }],
        },
      ],
    });

    async function publishRevision(productPublicIds: string[]) {
      const [menuRow] = await sqlClient<{ id: string }[]>`SELECT id FROM qos.catalogue_menus WHERE public_id = ${menu.publicId}`;
      await db.insert(catalogueMenuLiveRevisions).values({
        tenantId: quotes.tenant.id,
        menuId: menuRow!.id,
        locationId: quotes.location.id,
        sourceVersion: 1,
        publishedBySubject: "admin.cleanup@test",
        payload: {
          menuPublicId: menu.publicId,
          locationPublicId: quotes.location.publicId,
          version: 1,
          translations: { en: { displayName: "Breakfast", description: null } },
          sections: [
            {
              publicId: "sec_live",
              sortOrder: 0,
              translations: { en: { displayName: "Coffee", description: null } },
              products: productPublicIds.map((productPublicId, sortOrder) => ({
                productPublicId,
                sortOrder,
                translations: { en: { displayName: "Espresso", description: null } },
                price: { amountMinor: 1500, currency: "AED", inheritanceMode: "inherited" },
                mediaAssetId: null,
              })),
            },
          ],
        },
      });
    }
    await publishRevision([ids.espressoLive]);

    return { quotesId: quotes.tenant.id, flowersId: flowers.tenant.id, ids, publishRevision };
  }

  /** Runs a script as qos_app; a failed script leaves its BEGIN open, so roll it back before cleanup. */
  async function runScript(script: string) {
    await runAsRole(sqlClient, "qos_app", async () => {
      try {
        await sqlClient.unsafe(script);
      } catch (error) {
        await sqlClient`ROLLBACK`;
        throw error;
      }
    });
  }

  async function run(script: string, tenantId: string, mode?: "apply") {
    await sqlClient`SELECT set_config('qos.cleanup_tenant_id', ${tenantId}, false)`;
    await sqlClient`SELECT set_config('qos.cleanup_mode', ${mode ?? ""}, false)`;
    try {
      await runScript(script);
    } finally {
      await sqlClient`SELECT set_config('qos.cleanup_tenant_id', '', false)`;
      await sqlClient`SELECT set_config('qos.cleanup_mode', '', false)`;
    }
  }

  async function statuses() {
    const rows = await sqlClient<{ public_id: string; status: string }[]>`SELECT public_id, status::text FROM qos.catalogue_products ORDER BY public_id`;
    return Object.fromEntries(rows.map((row) => [row.public_id, row.status]));
  }

  async function scriptEvents() {
    return sqlClient<{ action: string; entity_public_id: string; change_summary: Record<string, unknown> }[]>`
      SELECT action, entity_public_id, change_summary FROM qos.tenant_audit_events
      WHERE change_summary->>'dataScript' = 'quotes-catalogue-cleanup-2026-11'
      ORDER BY occurred_at, entity_public_id`;
  }

  it("previews by default without changing anything", async () => {
    const { quotesId } = await seed();
    const before = await statuses();

    await run(APPLY_SQL, quotesId);

    expect(await statuses()).toEqual(before);
    expect(await scriptEvents()).toHaveLength(0);
  });

  it("archives the junk row and duplicates, keeping the published and menu-referenced survivors", async () => {
    const { quotesId, ids } = await seed();
    const before = await statuses();

    await run(APPLY_SQL, quotesId, "apply");

    const after = await statuses();
    expect(after).toEqual({
      ...before,
      [ids.formula]: "archived",
      [ids.espressoOriginal]: "archived",
      [ids.flatWhite]: "archived",
    });
    // Survivors: the published espresso (despite being newer) and the Flatwhite in a draft menu.
    expect(after[ids.espressoLive]).toBe("active");
    expect(after[ids.flatwhite]).toBe("draft");
    // Look-alikes and other tenants are untouched.
    expect(after[ids.espressoDouble]).toBe("draft");
    expect(after[ids.flowersEspressoA]).toBe("draft");
    expect(after[ids.flowersEspressoB]).toBe("draft");
    expect(after[ids.flowersFormula]).toBe("draft");

    const events = await scriptEvents();
    expect(events.map((event) => [event.entity_public_id, event.change_summary])).toEqual(
      expect.arrayContaining([
        [ids.formula, expect.objectContaining({ previousStatus: "draft", reason: "formula_test_row", survivorPublicId: null })],
        [ids.espressoOriginal, expect.objectContaining({ previousStatus: "draft", reason: "single_espresso", survivorPublicId: ids.espressoLive })],
        [ids.flatWhite, expect.objectContaining({ previousStatus: "draft", reason: "flat_white", survivorPublicId: ids.flatwhite })],
      ]),
    );
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.action === "catalogue.product.archived")).toBe(true);
  });

  it("is idempotent: a second apply archives nothing more", async () => {
    const { quotesId } = await seed();
    await run(APPLY_SQL, quotesId, "apply");
    const once = await statuses();

    await run(APPLY_SQL, quotesId, "apply");

    expect(await statuses()).toEqual(once);
    expect(await scriptEvents()).toHaveLength(3);
  });

  it("rolls back to the recorded statuses, idempotently", async () => {
    const { quotesId, ids } = await seed();
    await sqlClient`UPDATE qos.catalogue_products SET status = 'active' WHERE public_id = ${ids.flatWhite}`;
    const before = await statuses();
    await run(APPLY_SQL, quotesId, "apply");

    await run(ROLLBACK_SQL, quotesId);
    expect((await statuses())[ids.formula]).toBe("archived");

    await run(ROLLBACK_SQL, quotesId, "apply");
    expect(await statuses()).toEqual(before);
    expect((await statuses())[ids.flatWhite]).toBe("active");

    await run(ROLLBACK_SQL, quotesId, "apply");
    expect(await statuses()).toEqual(before);
    const events = await scriptEvents();
    expect(events.filter((event) => event.action === "catalogue.product.restored")).toHaveLength(3);
  });

  it("does not restore a product someone changed after the cleanup", async () => {
    const { quotesId, ids } = await seed();
    await run(APPLY_SQL, quotesId, "apply");
    await sqlClient`UPDATE qos.catalogue_products SET version = version + 1 WHERE public_id = ${ids.formula}`;

    await run(ROLLBACK_SQL, quotesId, "apply");

    const after = await statuses();
    expect(after[ids.formula]).toBe("archived");
    expect(after[ids.espressoOriginal]).toBe("draft");
  });

  it("skips a duplicate group when more than one row is published", async () => {
    const { quotesId, ids, publishRevision } = await seed();
    await sqlClient`DELETE FROM qos.catalogue_menu_live_revisions`;
    await publishRevision([ids.espressoLive, ids.espressoOriginal]);

    await run(APPLY_SQL, quotesId, "apply");

    const after = await statuses();
    expect(after[ids.espressoOriginal]).toBe("draft");
    expect(after[ids.espressoLive]).toBe("active");
    expect(after[ids.flatWhite]).toBe("archived");
  });

  it("refuses to run for any tenant other than Quotes", async () => {
    const { flowersId } = await seed();
    const before = await statuses();

    await expect(run(APPLY_SQL, flowersId, "apply")).rejects.toThrow(/not Quotes/);

    expect(await statuses()).toEqual(before);
    expect(await scriptEvents()).toHaveLength(0);
  });

  it("requires an explicit tenant id", async () => {
    await seed();
    const before = await statuses();

    await expect(runScript(APPLY_SQL)).rejects.toThrow(/qos\.cleanup_tenant_id/);

    expect(await statuses()).toEqual(before);
  });
});
