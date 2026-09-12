import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenuLiveRevisions,
  catalogueMenuPublicLinks,
  catalogueMenus,
  locations,
  tenants,
} from "@/db/schema";
import {
  parsePublicMenuLocale,
  toPublicMenuResponse,
  type PublicMenuLocale,
  type PublicMenuResponse,
  PublicMenuContractError,
} from "@/lib/catalogue/public-menu-contract";
import { findTenantByPublicId } from "@/lib/tenant/repository";
import { withTenantContext } from "@/lib/tenant/context";

export class PublicMenuResolverError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 404, field?: string) {
    super(message);
    this.name = "PublicMenuResolverError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export function deriveStableMenuPublicKey(
  menuPublicId: string,
  locationPublicId: string,
) {
  const digest = createHash("sha256")
    .update(`${menuPublicId}:${locationPublicId}`)
    .digest("hex")
    .slice(0, 16);

  return `mqr_${digest}`;
}

export async function ensureMenuPublicLink(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  menuPublicId: string,
  locationId: string,
  locationPublicId: string,
) {
  const publicKey = deriveStableMenuPublicKey(menuPublicId, locationPublicId);

  const [existing] = await tx
    .select()
    .from(catalogueMenuPublicLinks)
    .where(
      and(
        eq(catalogueMenuPublicLinks.tenantId, tenantId),
        eq(catalogueMenuPublicLinks.menuId, menuId),
        eq(catalogueMenuPublicLinks.locationId, locationId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === "paused") {
      await tx
        .update(catalogueMenuPublicLinks)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(catalogueMenuPublicLinks.id, existing.id));
    }

    return existing.publicKey;
  }

  await tx.insert(catalogueMenuPublicLinks).values({
    tenantId,
    menuId,
    locationId,
    publicKey,
    status: "active",
  });

  return publicKey;
}

async function loadPublishedSnapshot(
  tx: DbClient,
  tenantId: string,
  menuId: string,
  locationId: string,
) {
  const [menu] = await tx
    .select({ status: catalogueMenus.status })
    .from(catalogueMenus)
    .where(
      and(eq(catalogueMenus.tenantId, tenantId), eq(catalogueMenus.id, menuId)),
    )
    .limit(1);

  if (!menu || menu.status === "archived") {
    return null;
  }

  const [revision] = await tx
    .select({ payload: catalogueMenuLiveRevisions.payload })
    .from(catalogueMenuLiveRevisions)
    .where(
      and(
        eq(catalogueMenuLiveRevisions.tenantId, tenantId),
        eq(catalogueMenuLiveRevisions.menuId, menuId),
        eq(catalogueMenuLiveRevisions.locationId, locationId),
      ),
    )
    .limit(1);

  return revision?.payload ?? null;
}

export async function resolvePublicMenuByKey(
  db: DbClient,
  publicKey: string,
  localeInput: string | null,
): Promise<PublicMenuResponse> {
  const locale = parsePublicMenuLocale(localeInput);

  const [link] = await db
    .select()
    .from(catalogueMenuPublicLinks)
    .where(eq(catalogueMenuPublicLinks.publicKey, publicKey))
    .limit(1);

  if (!link || link.status !== "active") {
    throw new PublicMenuResolverError("Published menu link not found.", 404);
  }

  return withTenantContext(db, link.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ publicId: tenants.publicId })
      .from(tenants)
      .where(eq(tenants.id, link.tenantId))
      .limit(1);

    if (!tenant) {
      throw new PublicMenuResolverError("Published menu link not found.", 404);
    }

    const snapshot = await loadPublishedSnapshot(
      tx,
      link.tenantId,
      link.menuId,
      link.locationId,
    );

    if (!snapshot) {
      throw new PublicMenuResolverError(
        "Published menu is unavailable for this location.",
        404,
      );
    }

    return toPublicMenuResponse({
      publicKey,
      tenantPublicId: tenant.publicId,
      locale,
      snapshot,
    });
  });
}

export async function resolvePublicMenuByReference(
  db: DbClient,
  tenantPublicId: string,
  menuPublicId: string,
  locationPublicId: string,
  localeInput: string | null,
): Promise<PublicMenuResponse> {
  const locale = parsePublicMenuLocale(localeInput);

  const tenant = await findTenantByPublicId(db, tenantPublicId);
  if (!tenant) {
    throw new PublicMenuResolverError("Published menu not found.", 404);
  }

  return withTenantContext(db, tenant.id, async (tx) => {
    const [menu] = await tx
      .select({ id: catalogueMenus.id, status: catalogueMenus.status })
      .from(catalogueMenus)
      .where(
        and(
          eq(catalogueMenus.tenantId, tenant.id),
          eq(catalogueMenus.publicId, menuPublicId),
        ),
      )
      .limit(1);

    if (!menu || menu.status === "archived") {
      throw new PublicMenuResolverError("Published menu not found.", 404);
    }

    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, tenant.id),
          eq(locations.publicId, locationPublicId),
        ),
      )
      .limit(1);

    if (!location) {
      throw new PublicMenuResolverError("Published menu not found.", 404);
    }

    const publicKey = deriveStableMenuPublicKey(menuPublicId, locationPublicId);

    const [link] = await tx
      .select({ status: catalogueMenuPublicLinks.status })
      .from(catalogueMenuPublicLinks)
      .where(eq(catalogueMenuPublicLinks.publicKey, publicKey))
      .limit(1);

    if (!link || link.status !== "active") {
      throw new PublicMenuResolverError("Published menu not found.", 404);
    }

    const snapshot = await loadPublishedSnapshot(
      tx,
      tenant.id,
      menu.id,
      location.id,
    );

    if (!snapshot) {
      throw new PublicMenuResolverError(
        "Published menu is unavailable for this location.",
        404,
      );
    }

    return toPublicMenuResponse({
      publicKey,
      tenantPublicId: tenant.publicId,
      locale,
      snapshot,
    });
  });
}

export function mapPublicMenuRouteError(error: unknown) {
  if (error instanceof PublicMenuContractError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof PublicMenuResolverError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  }

  return {
    statusCode: 500,
    body: { error: "Unexpected error." },
  };
}

export function publicMenuCacheControl(releaseVersion: number, locale: PublicMenuLocale) {
  return {
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    Vary: "locale",
    ETag: `"menu-${releaseVersion}-${locale}"`,
  };
}
