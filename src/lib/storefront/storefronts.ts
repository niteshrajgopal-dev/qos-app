import { and, eq, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  brands,
  catalogueMenuPublicLinks,
  catalogueMenus,
  locations,
  type StorefrontDraftConfig,
  type StorefrontReleasePayload,
  storefrontDomains,
  storefrontLocations,
  storefrontPublishedCollections,
  storefrontReleases,
  storefronts,
} from "@/db/schema";
import { buildPublicId } from "@/lib/onboarding/validation";
import { withTenantContext } from "@/lib/tenant/context";

export class StorefrontError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "StorefrontError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class StorefrontConflictError extends StorefrontError {
  constructor(message: string, field?: string) {
    super(message, 409, field);
    this.name = "StorefrontConflictError";
  }
}

export function normalizeStorefrontHostname(hostname: string) {
  return hostname.trim().toLowerCase();
}

export type CreateStorefrontInput = {
  brandPublicId: string;
  internalName: string;
  slug: string;
  defaultLocale: string;
  supportedLocales: string[];
  draftConfig?: StorefrontDraftConfig;
  locationPublicIds?: string[];
};

export type UpdateStorefrontDraftInput = {
  expectedVersion: number;
  internalName?: string;
  draftConfig?: StorefrontDraftConfig;
};

export type RegisterStorefrontDomainInput = {
  hostname: string;
  domainType: "platform_subdomain" | "custom_domain";
  isPrimary?: boolean;
  verificationStatus?: "pending" | "verified" | "failed";
  lifecycleStatus?: "provisioning" | "active" | "inactive";
};

export async function createStorefront(
  db: DbClient,
  tenantId: string,
  input: CreateStorefrontInput,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [brand] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(
          eq(brands.tenantId, tenantId),
          eq(brands.publicId, input.brandPublicId),
        ),
      )
      .limit(1);

    if (!brand) {
      throw new StorefrontError("Brand not found.", 404, "brandPublicId");
    }

    const publicId = buildPublicId("stf", input.internalName);

    const [storefront] = await tx
      .insert(storefronts)
      .values({
        tenantId,
        brandId: brand.id,
        publicId,
        internalName: input.internalName,
        slug: input.slug,
        defaultLocale: input.defaultLocale,
        supportedLocales: input.supportedLocales,
        draftConfig: input.draftConfig ?? {},
      })
      .returning();

    if (input.locationPublicIds?.length) {
      for (const locationPublicId of input.locationPublicIds) {
        await assignStorefrontLocationInTx(
          tx,
          tenantId,
          storefront.id,
          locationPublicId,
        );
      }
    }

    return storefront;
  });
}

async function assignStorefrontLocationInTx(
  tx: DbClient,
  tenantId: string,
  storefrontId: string,
  locationPublicId: string,
) {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.publicId, locationPublicId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new StorefrontError(
      "Location not found for this tenant.",
      404,
      "locationPublicId",
    );
  }

  await tx.insert(storefrontLocations).values({
    tenantId,
    storefrontId,
    locationId: location.id,
  });
}

export async function assignStorefrontLocation(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  locationPublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    await assignStorefrontLocationInTx(
      tx,
      tenantId,
      storefront.id,
      locationPublicId,
    );
  });
}

export async function registerStorefrontDomain(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  input: RegisterStorefrontDomainInput,
) {
  const hostname = normalizeStorefrontHostname(input.hostname);

  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    const [existingHostname] = await tx
      .select({ id: storefrontDomains.id })
      .from(storefrontDomains)
      .where(eq(storefrontDomains.hostname, hostname))
      .limit(1);

    if (existingHostname) {
      throw new StorefrontConflictError(
        "Hostname is already registered.",
        "hostname",
      );
    }

    const [domain] = await tx
      .insert(storefrontDomains)
      .values({
        tenantId,
        storefrontId: storefront.id,
        hostname,
        domainType: input.domainType,
        verificationStatus: input.verificationStatus ?? "pending",
        lifecycleStatus: input.lifecycleStatus ?? "provisioning",
        isPrimary: input.isPrimary ?? false,
      })
      .returning();

    return domain;
  });
}

export async function updateStorefrontDraft(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  input: UpdateStorefrontDraftInput,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    if (storefront.version !== input.expectedVersion) {
      throw new StorefrontConflictError(
        "Storefront draft has changed since it was loaded.",
        "expectedVersion",
      );
    }

    const [updated] = await tx
      .update(storefronts)
      .set({
        internalName: input.internalName ?? storefront.internalName,
        draftConfig: input.draftConfig ?? storefront.draftConfig,
        version: storefront.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.id, storefront.id),
          eq(storefronts.version, input.expectedVersion),
        ),
      )
      .returning();

    if (!updated) {
      throw new StorefrontConflictError(
        "Storefront draft has changed since it was loaded.",
        "expectedVersion",
      );
    }

    return updated;
  });
}

export async function assignPublishedCollection(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  locationPublicId: string,
  menuPublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    const [location] = await tx
      .select({ id: locations.id, publicId: locations.publicId })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, tenantId),
          eq(locations.publicId, locationPublicId),
        ),
      )
      .limit(1);

    if (!location) {
      throw new StorefrontError("Location not found.", 404, "locationPublicId");
    }

    const [menu] = await tx
      .select({ id: catalogueMenus.id, publicId: catalogueMenus.publicId })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenantId),
          eq(catalogueMenus.publicId, menuPublicId),
        ),
      )
      .limit(1);

    if (!menu) {
      throw new StorefrontError("Menu not found.", 404, "menuPublicId");
    }

    const [assignment] = await tx
      .insert(storefrontPublishedCollections)
      .values({
        tenantId,
        storefrontId: storefront.id,
        locationId: location.id,
        menuId: menu.id,
      })
      .onConflictDoUpdate({
        target: [
          storefrontPublishedCollections.tenantId,
          storefrontPublishedCollections.storefrontId,
          storefrontPublishedCollections.locationId,
        ],
        set: {
          menuId: menu.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    return assignment;
  });
}

export async function publishStorefrontRelease(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  publisherSubject: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    const assignedLocations = await tx
      .select({
        locationPublicId: locations.publicId,
      })
      .from(storefrontLocations)
      .innerJoin(
        locations,
        and(
          eq(storefrontLocations.tenantId, locations.tenantId),
          eq(storefrontLocations.locationId, locations.id),
        ),
      )
      .where(
        and(
          eq(storefrontLocations.tenantId, tenantId),
          eq(storefrontLocations.storefrontId, storefront.id),
        ),
      );

    const collections = await tx
      .select({
        locationPublicId: locations.publicId,
        menuPublicId: catalogueMenus.publicId,
        menuId: catalogueMenus.id,
        locationId: locations.id,
      })
      .from(storefrontPublishedCollections)
      .innerJoin(
        locations,
        and(
          eq(storefrontPublishedCollections.tenantId, locations.tenantId),
          eq(storefrontPublishedCollections.locationId, locations.id),
        ),
      )
      .innerJoin(
        catalogueMenus,
        and(
          eq(storefrontPublishedCollections.tenantId, catalogueMenus.tenantId),
          eq(storefrontPublishedCollections.menuId, catalogueMenus.id),
        ),
      )
      .where(
        and(
          eq(storefrontPublishedCollections.tenantId, tenantId),
          eq(storefrontPublishedCollections.storefrontId, storefront.id),
        ),
      );

    const publishedCollections = await Promise.all(
      collections.map(async (collection) => {
        const [link] = await tx
          .select({ publicKey: catalogueMenuPublicLinks.publicKey })
          .from(catalogueMenuPublicLinks)
          .where(
            and(
              eq(catalogueMenuPublicLinks.tenantId, tenantId),
              eq(catalogueMenuPublicLinks.menuId, collection.menuId),
              eq(catalogueMenuPublicLinks.locationId, collection.locationId),
            ),
          )
          .limit(1);

        return {
          locationPublicId: collection.locationPublicId,
          menuPublicId: collection.menuPublicId,
          publicMenuKey: link?.publicKey,
        };
      }),
    );

    const [latestRelease] = await tx
      .select({ maxVersion: max(storefrontReleases.releaseVersion) })
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.tenantId, tenantId),
          eq(storefrontReleases.storefrontId, storefront.id),
        ),
      );

    const nextReleaseVersion = (latestRelease?.maxVersion ?? 0) + 1;

    const payload: StorefrontReleasePayload = {
      storefrontPublicId: storefront.publicId,
      releaseVersion: nextReleaseVersion,
      defaultLocale: storefront.defaultLocale,
      supportedLocales: storefront.supportedLocales,
      theme: storefront.draftConfig.theme ?? {},
      navigation: storefront.draftConfig.navigation ?? [],
      contentBlocks: storefront.draftConfig.contentBlocks ?? [],
      locations: assignedLocations.map((row) => ({
        locationPublicId: row.locationPublicId,
      })),
      publishedCollections,
      featureFlags: storefront.draftConfig.featureFlags,
    };

    const [release] = await tx
      .insert(storefrontReleases)
      .values({
        tenantId,
        storefrontId: storefront.id,
        publicId: `rel_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        releaseVersion: nextReleaseVersion,
        payload,
        publishedBySubject: publisherSubject,
      })
      .returning();

    await tx
      .update(storefronts)
      .set({
        activeReleaseId: release.id,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(eq(storefronts.tenantId, tenantId), eq(storefronts.id, storefront.id)),
      );

    return release;
  });
}

async function requireStorefrontByPublicId(
  tx: DbClient,
  tenantId: string,
  storefrontPublicId: string,
) {
  const [storefront] = await tx
    .select()
    .from(storefronts)
    .where(
      and(
        eq(storefronts.tenantId, tenantId),
        eq(storefronts.publicId, storefrontPublicId),
      ),
    )
    .limit(1);

  if (!storefront) {
    throw new StorefrontError("Storefront not found.", 404);
  }

  return storefront;
}

export async function getStorefrontRelease(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  releasePublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    const [release] = await tx
      .select()
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.tenantId, tenantId),
          eq(storefrontReleases.storefrontId, storefront.id),
          eq(storefrontReleases.publicId, releasePublicId),
        ),
      )
      .limit(1);

    if (!release) {
      throw new StorefrontError("Storefront release not found.", 404);
    }

    return release;
  });
}
