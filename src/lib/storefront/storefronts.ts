import { and, asc, eq, max } from "drizzle-orm";
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
import {
  recordTenantAuditEventInTx,
  type AuditActorClass,
} from "@/lib/audit/tenant-audit";
import { buildPublicId } from "@/lib/onboarding/validation";
import type { TenantDbExecutor } from "@/lib/tenant/context";
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

export type StorefrontDraftAuditContext = {
  actorSubject: string;
  actorClass: AuditActorClass;
  action: string;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
};

export type UpdateStorefrontDraftInput = {
  expectedVersion: number;
  internalName?: string;
  draftConfig?: StorefrontDraftConfig;
  audit?: StorefrontDraftAuditContext;
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

export async function updateStorefrontDraftInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  storefrontPublicId: string,
  input: UpdateStorefrontDraftInput,
) {
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

  if (input.audit) {
    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: input.audit.actorSubject,
      actorClass: input.audit.actorClass,
      action: input.audit.action,
      entityType: "storefront",
      entityPublicId: storefrontPublicId,
      entityVersion: updated.version,
      changeSummary: {
        before: input.audit.beforeSummary,
        after: input.audit.afterSummary,
      },
    });
  }

  return updated;
}

export async function updateStorefrontDraft(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  input: UpdateStorefrontDraftInput,
) {
  return withTenantContext(db, tenantId, async (tx) =>
    updateStorefrontDraftInTx(tx, tenantId, storefrontPublicId, input),
  );
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

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeJson(nested)]),
    );
  }

  return value;
}

function comparableReleasePayload(payload: StorefrontReleasePayload) {
  const comparable = { ...payload };
  delete comparable.releaseVersion;
  return comparable;
}

export function storefrontReleasePayloadsEqual(
  left: StorefrontReleasePayload,
  right: StorefrontReleasePayload,
) {
  return (
    JSON.stringify(canonicalizeJson(comparableReleasePayload(left))) ===
    JSON.stringify(canonicalizeJson(comparableReleasePayload(right)))
  );
}

async function buildStorefrontReleasePayload(
  tx: DbClient,
  tenantId: string,
  storefront: {
    id: string;
    publicId: string;
    defaultLocale: string;
    supportedLocales: string[];
    draftConfig: {
      theme?: Record<string, unknown>;
      navigation?: StorefrontReleasePayload["navigation"];
      contentBlocks?: StorefrontReleasePayload["contentBlocks"];
      featureFlags?: StorefrontReleasePayload["featureFlags"];
    };
  },
  releaseVersion: number,
): Promise<StorefrontReleasePayload> {
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

  return {
    storefrontPublicId: storefront.publicId,
    releaseVersion,
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
}

export type PublishedStorefrontRelease = {
  id: string;
  publicId: string;
  releaseVersion: number;
  payload: StorefrontReleasePayload;
  publishedBySubject: string;
  createdAt: Date;
  idempotentReplay: boolean;
};

export async function publishStorefrontReleaseInTx(
  tx: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  publisherSubject: string,
): Promise<PublishedStorefrontRelease> {
  const storefront = await requireStorefrontByPublicId(
    tx,
    tenantId,
    storefrontPublicId,
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
  const payload = await buildStorefrontReleasePayload(
    tx,
    tenantId,
    storefront,
    nextReleaseVersion,
  );

  if (storefront.activeReleaseId) {
    const [activeRelease] = await tx
      .select()
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.tenantId, tenantId),
          eq(storefrontReleases.id, storefront.activeReleaseId),
        ),
      )
      .limit(1);

    if (
      activeRelease &&
      storefrontReleasePayloadsEqual(activeRelease.payload, payload)
    ) {
      return {
        ...activeRelease,
        idempotentReplay: true,
      };
    }
  }

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

  await recordTenantAuditEventInTx(tx, {
    tenantId,
    actorSubject: publisherSubject,
    actorClass: "staff_administrator",
    action: "storefront.publish",
    entityType: "storefront_release",
    entityPublicId: release.publicId,
    entityVersion: release.releaseVersion,
    changeSummary: {
      storefrontPublicId,
      releaseVersion: release.releaseVersion,
      previousActiveReleaseId: storefront.activeReleaseId ?? null,
    },
  });

  return {
    ...release,
    idempotentReplay: false,
  };
}

export async function publishStorefrontRelease(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  publisherSubject: string,
) {
  return withTenantContext(db, tenantId, async (tx) =>
    publishStorefrontReleaseInTx(
      tx,
      tenantId,
      storefrontPublicId,
      publisherSubject,
    ),
  );
}

export type StorefrontRollbackResult = {
  storefrontPublicId: string;
  releasePublicId: string;
  releaseVersion: number;
  idempotentReplay: boolean;
  rolledBackBySubject?: string;
};

export async function rollbackStorefrontRelease(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
  releasePublicId: string,
  actorSubject: string,
): Promise<StorefrontRollbackResult> {
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

    if (storefront.activeReleaseId === release.id) {
      return {
        storefrontPublicId,
        releasePublicId: release.publicId,
        releaseVersion: release.releaseVersion,
        idempotentReplay: true,
      };
    }

    const previousActiveReleaseId = storefront.activeReleaseId;

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

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: actorSubject,
      actorClass: "staff_administrator",
      action: "storefront.rollback",
      entityType: "storefront_release",
      entityPublicId: release.publicId,
      entityVersion: release.releaseVersion,
      changeSummary: {
        storefrontPublicId,
        releaseVersion: release.releaseVersion,
        previousActiveReleaseId,
      },
    });

    return {
      storefrontPublicId,
      releasePublicId: release.publicId,
      releaseVersion: release.releaseVersion,
      idempotentReplay: false,
      rolledBackBySubject: actorSubject,
    };
  });
}

export async function listStorefrontReleases(
  db: DbClient,
  tenantId: string,
  storefrontPublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const storefront = await requireStorefrontByPublicId(
      tx,
      tenantId,
      storefrontPublicId,
    );

    const rows = await tx
      .select({
        id: storefrontReleases.id,
        publicId: storefrontReleases.publicId,
        releaseVersion: storefrontReleases.releaseVersion,
        publishedBySubject: storefrontReleases.publishedBySubject,
        createdAt: storefrontReleases.createdAt,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefrontReleases)
      .innerJoin(
        storefronts,
        and(
          eq(storefronts.tenantId, storefrontReleases.tenantId),
          eq(storefronts.id, storefrontReleases.storefrontId),
        ),
      )
      .where(
        and(
          eq(storefrontReleases.tenantId, tenantId),
          eq(storefrontReleases.storefrontId, storefront.id),
        ),
      )
      .orderBy(asc(storefrontReleases.releaseVersion));

    return rows.map((row) => ({
      publicId: row.publicId,
      releaseVersion: row.releaseVersion,
      publishedBySubject: row.publishedBySubject,
      createdAt: row.createdAt,
      isActive: row.activeReleaseId === row.id,
    }));
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
