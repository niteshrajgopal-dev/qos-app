import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  locations,
  staffInvitations,
  staffMemberships,
  storefrontDomains,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { addTenantLocation } from "@/lib/onboarding/add-location";
import {
  previewProvisionBusiness,
  provisionBusiness,
} from "@/lib/onboarding/provision-business";
import {
  OperatorAuthorizationError,
  requireOperatorIdentity,
} from "@/lib/platform/operator-auth";

const describeIntegration = hasIntegrationDatabase()
  ? describe
  : describe.skip;

describeIntegration("operator onboarding", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    process.env.PLATFORM_OPERATOR_API_KEY = "test-operator-key";
    ({ db, sql: sqlClient } = await resetAndMigrate());
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    delete process.env.PLATFORM_OPERATOR_API_KEY;
    await sqlClient.end({ timeout: 5 });
  });

  const operator = { subject: "operator@qosapp.com" };

  const quotesPayload = {
    businessName: "Quotes",
    businessProfile: "hospitality" as const,
    brandName: "Quotes",
    locationName: "HBZ Stadium",
    locationTimezone: "Asia/Dubai",
    administratorEmail: "admin@quotes.test",
    baseCurrency: "AED",
    defaultLocale: "en",
    supportedLocales: ["en", "ar"],
  };

  const flowerPayload = {
    businessName: "Synthetic Flower Shop",
    businessProfile: "generic_retail" as const,
    brandName: "Flowers",
    locationName: "Main Shop",
    locationTimezone: "Asia/Dubai",
    administratorEmail: "admin@flowers.test",
    baseCurrency: "AED",
    defaultLocale: "en",
    supportedLocales: ["en", "ar"],
  };

  it("creates isolated Quotes and flower tenants with pending administrator invitations", async () => {
    const quotes = await provisionBusiness(
      db,
      operator,
      "op-quotes-1",
      quotesPayload,
    );
    const flowers = await provisionBusiness(
      db,
      operator,
      "op-flowers-1",
      flowerPayload,
    );

    expect(quotes.tenant.publicId).not.toBe(flowers.tenant.publicId);
    expect(quotes.invitation.status).toBe("pending");
    expect(quotes.invitation.deliveryStatus).toBe("pending");

    const memberships = await db.select().from(staffMemberships);
    expect(memberships).toHaveLength(0);

    const invitations = await db.select().from(staffInvitations);
    expect(invitations).toHaveLength(2);

    const storefrontRows = await db.select().from(storefronts);
    expect(storefrontRows).toHaveLength(2);
    expect(quotes.storefront.status).toBe("draft");
    expect(quotes.platformDomain.lifecycleStatus).toBe("provisioning");
    expect(quotes.onboardingStatus.storefrontDraftReady).toBe(true);
    expect(quotes.platformDomain.hostname).toContain("dev.qosapp.com");
    expect(flowers.platformDomain.hostname).not.toBe(quotes.platformDomain.hostname);
  });

  it("replays the same idempotency key without creating a duplicate tenant", async () => {
    const first = await provisionBusiness(
      db,
      operator,
      "op-idempotent-1",
      quotesPayload,
    );
    const second = await provisionBusiness(
      db,
      operator,
      "op-idempotent-1",
      quotesPayload,
    );

    expect(second.idempotentReplay).toBe(true);
    expect(second.tenant.id).toBe(first.tenant.id);
    expect(second.storefront.publicId).toBe(first.storefront.publicId);
    expect(second.platformDomain.hostname).toBe(first.platformDomain.hostname);

    const tenantRows = await db.select().from(tenants);
    expect(tenantRows).toHaveLength(1);

    const storefrontRows = await db.select().from(storefronts);
    expect(storefrontRows).toHaveLength(1);
  });

  it("rejects cross-tenant brand usage when adding a location", async () => {
    const quotes = await provisionBusiness(
      db,
      operator,
      "op-quotes-location",
      quotesPayload,
    );
    const flowers = await provisionBusiness(
      db,
      operator,
      "op-flowers-location",
      flowerPayload,
    );

    await expect(
      addTenantLocation(db, {
        tenantId: quotes.tenant.id,
        brandId: flowers.brand.id,
        name: "Invalid Branch",
        timezone: "Asia/Dubai",
      }),
    ).rejects.toThrow(/Brand not found/);

    const location = await addTenantLocation(db, {
      tenantId: quotes.tenant.id,
      brandId: quotes.brand.id,
      name: "HCT Academic City",
      timezone: "Asia/Dubai",
    });

    expect(location.slug).toBe("hct-academic-city");

    const quoteLocations = await db
      .select()
      .from(locations)
      .where(eq(locations.tenantId, quotes.tenant.id));

    expect(quoteLocations).toHaveLength(2);
  });

  it("stores the provisioning operator on the tenant record", async () => {
    const result = await provisionBusiness(
      db,
      operator,
      "op-audit-1",
      quotesPayload,
    );

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, result.tenant.id));

    expect(tenant.provisionedByOperatorId).toBe(operator.subject);
  });

  it("resolves platform hostname collisions without invalidating either tenant", async () => {
    const sharedBrandPayload = {
      businessName: "Acme Cafe North",
      businessProfile: "hospitality" as const,
      brandName: "Acme Cafe",
      locationName: "North Branch",
      locationTimezone: "Asia/Dubai",
      administratorEmail: "north@acme.test",
      baseCurrency: "AED",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    };

    const first = await provisionBusiness(
      db,
      operator,
      "op-acme-north",
      sharedBrandPayload,
    );
    const second = await provisionBusiness(db, operator, "op-acme-south", {
      ...sharedBrandPayload,
      businessName: "Acme Cafe South",
      locationName: "South Branch",
      administratorEmail: "south@acme.test",
    });

    expect(first.platformDomain.hostname).toBe("acme-cafe.dev.qosapp.com");
    expect(second.platformDomain.collisionSuffix).toBe("1");
    expect(second.platformDomain.hostname).toBe("acme-cafe-1.dev.qosapp.com");
    expect(first.tenant.id).not.toBe(second.tenant.id);

    const domains = await db.select().from(storefrontDomains);
    expect(domains).toHaveLength(2);
  });

  it("seeds profile-specific storefront themes without auto-publishing", async () => {
    const quotes = await provisionBusiness(
      db,
      operator,
      "op-theme-quotes",
      quotesPayload,
    );
    const flowers = await provisionBusiness(
      db,
      operator,
      "op-theme-flowers",
      flowerPayload,
    );

    const [quotesStorefront] = await db
      .select()
      .from(storefronts)
      .where(eq(storefronts.publicId, quotes.storefront.publicId));
    const [flowerStorefront] = await db
      .select()
      .from(storefronts)
      .where(eq(storefronts.publicId, flowers.storefront.publicId));

    expect(quotesStorefront.draftConfig.theme).toMatchObject({
      preset: "hospitality_baseline",
    });
    expect(flowerStorefront.draftConfig.theme).toMatchObject({
      preset: "generic_retail_baseline",
    });
    expect(quotesStorefront.activeReleaseId).toBeNull();
    expect(flowerStorefront.activeReleaseId).toBeNull();

    const preview = previewProvisionBusiness(quotesPayload);
    expect(preview.proposedPlatformHostname).toBe("quotes.dev.qosapp.com");
  });
});

describe("requireOperatorIdentity", () => {
  afterAll(() => {
    delete process.env.PLATFORM_OPERATOR_API_KEY;
  });

  it("requires configured operator auth for direct provisioning attempts", () => {
    delete process.env.PLATFORM_OPERATOR_API_KEY;
    const headers = new Headers({
      "x-qos-operator-key": "missing-config",
      "x-qos-operator-subject": "operator@qosapp.com",
    });

    expect(() => requireOperatorIdentity(headers)).toThrow(
      OperatorAuthorizationError,
    );
  });
});
