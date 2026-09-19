import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import {
  applyCatalogueImport,
  previewCatalogueImport,
} from "@/lib/catalogue/catalogue-import";
import { CATALOGUE_IMPORT_SAMPLE_CSV } from "@/lib/catalogue/catalogue-import-sample";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue import", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedStaffMember(
    tenantId: string,
    role: "administrator" | "user",
    subject: string,
    email: string,
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email })
      .returning();

    await db.insert(staffMemberships).values({
      tenantId,
      staffIdentityId: identity.id,
      role,
    });

    return {
      membershipId: identity.id,
      role,
      staffIdentityId: identity.id,
    };
  }

  it("previews and applies synthetic CSV without duplicate creates on replay", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import@test",
      "admin.import@test",
    );

    const preview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-001",
      },
    );

    expect(preview.preview.createCount).toBe(3);
    expect(preview.preview.errorCount).toBe(0);

    const apply = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        operationPublicId: preview.operationPublicId,
        previewHash: preview.previewHash,
        idempotencyKey: "preview-001",
      },
    );

    expect(apply.replayed).toBe(false);
    expect(apply.report.createCount).toBe(3);
    expect(apply.report.errorCount).toBe(0);

    const replay = await applyCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        operationPublicId: preview.operationPublicId,
        previewHash: preview.previewHash,
        idempotencyKey: "preview-001",
      },
    );

    expect(replay.replayed).toBe(true);
    expect(replay.report.createCount).toBe(3);

    const replayPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-001",
      },
    );

    expect(replayPreview.replayed).toBe(true);
    expect(replayPreview.operationPublicId).toBe(preview.operationPublicId);

    const secondPreview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-002",
      },
    );

    expect(secondPreview.preview.createCount).toBe(0);
    expect(secondPreview.preview.unchangedCount).toBe(3);
  });

  it("applies import under qos_app RLS without a preset tenant context", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.import.rls@test",
      "admin.import.rls@test",
    );

    const preview = await previewCatalogueImport(
      db,
      quotes.tenant.id,
      admin,
      "admin.import.rls@test",
      {
        fileName: "quotes-synthetic.csv",
        bytes: Buffer.from(CATALOGUE_IMPORT_SAMPLE_CSV, "utf8"),
        connectionKey: "quotes.synthetic",
        idempotencyKey: "preview-rls-001",
      },
    );

    await runAsRole(sqlClient, "qos_app", async () => {
      const apply = await applyCatalogueImport(
        db,
        quotes.tenant.id,
        admin,
        "admin.import.rls@test",
        {
          operationPublicId: preview.operationPublicId,
          previewHash: preview.previewHash,
          idempotencyKey: "preview-rls-001",
        },
      );

      expect(apply.report.createCount).toBe(3);
      expect(apply.report.errorCount).toBe(0);
    });
  });
});
