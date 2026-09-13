import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import {
  listTenantAuditEventsInTx,
  parseAuditEventsQuery,
  recordTenantAuditEventInTx,
  resolveAuditCorrelationId,
  sanitizeAuditChangeSummary,
} from "@/lib/audit/tenant-audit";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  rollbackStorefrontReleaseAsAdministrator,
} from "@/lib/storefront/storefront-publish";
import {
  createStorefront,
  publishStorefrontRelease,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { withTenantContext } from "@/lib/tenant/context";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

describe("parseAuditEventsQuery", () => {
  it("parses filters without broadening tenant scope", () => {
    const params = new URLSearchParams({
      action: "catalogue.menu.publish",
      entityType: "catalogue_menu",
      entityPublicId: "mnu_test",
      actorSubject: "admin.quotes@test",
      limit: "10",
    });

    expect(parseAuditEventsQuery(params)).toMatchObject({
      action: "catalogue.menu.publish",
      entityType: "catalogue_menu",
      entityPublicId: "mnu_test",
      actorSubject: "admin.quotes@test",
      limit: 10,
    });
  });
});

describe("resolveAuditCorrelationId", () => {
  it("returns a UUID when omitted", () => {
    expect(resolveAuditCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("accepts a valid UUID", () => {
    const id = "c76a0c0c-8a65-4178-b20e-76d50f77b030";
    expect(resolveAuditCorrelationId(id)).toBe(id);
  });

  it("rejects a public operation id that is not a UUID", () => {
    expect(() => resolveAuditCorrelationId("pub_retry_1")).toThrow(
      /correlationId must be a valid UUID/,
    );
  });
});

describe("sanitizeAuditChangeSummary", () => {
  it("redacts sensitive keys and preserves safe metadata", () => {
    expect(
      sanitizeAuditChangeSummary({
        preset: "hospitality_baseline",
        apiKey: "sk-live-secret",
        nested: {
          password: "hunter2",
          releaseVersion: 3,
        },
      }),
    ).toEqual({
      preset: "hospitality_baseline",
      apiKey: "[redacted]",
      nested: {
        password: "[redacted]",
        releaseVersion: 3,
      },
    });
  });
});

integrationDescribe("tenant audit events", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient.end({ timeout: 5 });
    }
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.storefront_locations, qos.storefront_releases, qos.storefronts, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(tenantId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "admin.quotes@test",
        email: "admin.quotes@test",
      })
      .returning();

    await db.insert(staffMemberships).values({
      tenantId,
      staffIdentityId: identity.id,
      role: "administrator",
    });

    return "admin.quotes@test";
  }

  it("records publish and rollback audit events without idempotent duplicates", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Online",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.location.publicId],
    });

    const admin = await seedAdministrator(quotes.tenant.id);

    const firstPublish = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      admin,
    );

    await updateStorefrontDraft(db, quotes.tenant.id, storefront.publicId, {
      expectedVersion: 1,
      draftConfig: {
        ...defaultStorefrontDraftConfig("hospitality"),
        theme: {
          preset: "hospitality_baseline",
          colors: { primary: "#222222" },
        },
      },
    });

    const secondPublish = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      admin,
    );

    expect(secondPublish.idempotentReplay).toBe(false);

    const replayPublish = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      admin,
    );

    expect(replayPublish.idempotentReplay).toBe(true);

    const publishEvents = await withTenantContext(
      db,
      quotes.tenant.id,
      async (tx) =>
        listTenantAuditEventsInTx(tx, quotes.tenant.id, {
          action: "storefront.publish",
        }),
    );

    expect(publishEvents.events).toHaveLength(2);
    expect(publishEvents.events.map((event) => event.entityPublicId)).toEqual([
      secondPublish.publicId,
      firstPublish.publicId,
    ]);

    const rollback = await rollbackStorefrontReleaseAsAdministrator(
      db,
      quotes.tenant.id,
      admin,
      storefront.publicId,
      firstPublish.publicId,
    );

    expect(rollback.idempotentReplay).toBe(false);

    const replayRollback = await rollbackStorefrontReleaseAsAdministrator(
      db,
      quotes.tenant.id,
      admin,
      storefront.publicId,
      firstPublish.publicId,
    );

    expect(replayRollback.idempotentReplay).toBe(true);

    const rollbackEvents = await withTenantContext(
      db,
      quotes.tenant.id,
      async (tx) =>
        listTenantAuditEventsInTx(tx, quotes.tenant.id, {
          action: "storefront.rollback",
        }),
    );

    expect(rollbackEvents.events).toHaveLength(1);
    expect(rollbackEvents.events[0]?.entityPublicId).toBe(firstPublish.publicId);
  });

  it("isolates audit events by tenant under qos_app", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    await withTenantContext(db, quotes.tenant.id, async (tx) => {
      await recordTenantAuditEventInTx(tx, {
        tenantId: quotes.tenant.id,
        actorSubject: "admin.quotes@test",
        actorClass: "staff_administrator",
        action: "storefront.publish",
        entityType: "storefront_release",
        entityPublicId: "rel_quotes_only",
        entityVersion: 1,
        changeSummary: { storefrontPublicId: "stf_quotes" },
      });
    });

    await runAsRole(sqlClient, "qos_app", async () => {
      const visibleForQuotes = await withTenantContext(
        db,
        quotes.tenant.id,
        async (tx) => listTenantAuditEventsInTx(tx, quotes.tenant.id),
      );
      expect(visibleForQuotes.events).toHaveLength(1);

      const hiddenFromQuotes = await withTenantContext(
        db,
        quotes.tenant.id,
        async (tx) =>
          listTenantAuditEventsInTx(tx, quotes.tenant.id, {
            entityPublicId: "rel_quotes_only",
          }),
      );
      expect(hiddenFromQuotes.events).toHaveLength(1);

      const crossTenantLookup = await withTenantContext(
        db,
        flowers.tenant.id,
        async (tx) =>
          listTenantAuditEventsInTx(tx, flowers.tenant.id, {
            entityPublicId: "rel_quotes_only",
          }),
      );
      expect(crossTenantLookup.events).toHaveLength(0);
    });
  });

  it("denies qos_app UPDATE and DELETE on audit rows", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    const event = await withTenantContext(db, quotes.tenant.id, async (tx) =>
      recordTenantAuditEventInTx(tx, {
        tenantId: quotes.tenant.id,
        actorSubject: "admin.quotes@test",
        actorClass: "staff_administrator",
        action: "storefront.theme_draft.save",
        entityType: "storefront",
        entityPublicId: "stf_test",
        entityVersion: 2,
        changeSummary: { preset: "hospitality_baseline" },
      }),
    );

    await runAsRole(sqlClient, "qos_app", async () => {
      await expect(
        sqlClient`update qos.tenant_audit_events set action = ${"storefront.publish"} where id = ${event.id}`,
      ).rejects.toThrow(/permission denied/);

      await expect(
        sqlClient`delete from qos.tenant_audit_events where id = ${event.id}`,
      ).rejects.toThrow(/permission denied/);
    });

    const stillPresent = await withTenantContext(
      db,
      quotes.tenant.id,
      async (tx) => listTenantAuditEventsInTx(tx, quotes.tenant.id),
    );
    expect(stillPresent.events).toHaveLength(1);
    expect(stillPresent.events[0]?.action).toBe("storefront.theme_draft.save");
  });

  it("records draft update audit entries atomically with storefront draft saves", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Online",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.location.publicId],
    });

    await updateStorefrontDraft(db, quotes.tenant.id, storefront.publicId, {
      expectedVersion: storefront.version,
      draftConfig: {
        ...storefront.draftConfig,
        theme: {
          ...defaultStorefrontDraftConfig("hospitality").theme!,
          preset: "hospitality_baseline",
        },
      },
      audit: {
        actorSubject: "admin.quotes@test",
        actorClass: "staff_administrator",
        action: "storefront.theme_draft.save",
        beforeSummary: { preset: "hospitality_baseline" },
        afterSummary: { preset: "hospitality_baseline" },
      },
    });

    const events = await withTenantContext(
      db,
      quotes.tenant.id,
      async (tx) =>
        listTenantAuditEventsInTx(tx, quotes.tenant.id, {
          action: "storefront.theme_draft.save",
        }),
    );

    expect(events.events).toHaveLength(1);
    expect(events.events[0]?.entityPublicId).toBe(storefront.publicId);
    expect(events.events[0]?.entityVersion).toBe(storefront.version + 1);
  });
});
