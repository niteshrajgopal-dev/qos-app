import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueProducts,
  catalogueVariantLocationPriceOverrides,
  catalogueVariantLocationPriceResetAudits,
  catalogueVariantPrices,
  catalogueVariants,
  locations,
} from "@/db/schema";
import {
  resolveLocationVariantPrice,
  type ResolvedLocationPrice,
} from "@/lib/catalogue/location-price-resolver";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { listTenantLocations } from "@/lib/tenant/repository";
import { withTenantContext } from "@/lib/tenant/context";

export class LocationPriceOverrideError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "LocationPriceOverrideError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export type ProductLocationPriceView = {
  locationPublicId: string;
  locationName: string;
  currency: string;
  amountMinor: number;
  inheritanceMode: ResolvedLocationPrice["inheritanceMode"];
  centralPriceVersion: number;
  overrideAmountMinor: number | null;
  canResetToCentral: boolean;
};

export type ProductLocationPriceBundle = {
  productPublicId: string;
  variantPublicId: string;
  centralAmountMinor: number;
  centralPriceVersion: number;
  currency: string;
  canEditPrice: boolean;
  locations: ProductLocationPriceView[];
};

function mapLocationPriceError(error: unknown): never {
  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof LocationPriceOverrideError) {
    throw error;
  }

  throw error;
}

function requirePriceEditCapability(membership: ActiveStaffMembership) {
  if (membership.role !== "administrator") {
    throw new StaffAuthorizationError(
      "Administrator membership is required to change location prices.",
    );
  }
}

async function loadDefaultVariantContext(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
) {
  const [product] = await tx
    .select({ id: catalogueProducts.id })
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);

  if (!product) {
    return null;
  }

  const [variant] = await tx
    .select({
      id: catalogueVariants.id,
      publicId: catalogueVariants.publicId,
    })
    .from(catalogueVariants)
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        eq(catalogueVariants.productId, product.id),
        eq(catalogueVariants.isDefault, true),
      ),
    )
    .limit(1);

  if (!variant) {
    return null;
  }

  const [centralPrice] = await tx
    .select()
    .from(catalogueVariantPrices)
    .where(
      and(
        eq(catalogueVariantPrices.tenantId, tenantId),
        eq(catalogueVariantPrices.variantId, variant.id),
      ),
    )
    .limit(1);

  if (!centralPrice) {
    return null;
  }

  return { product, variant, centralPrice };
}

async function resolveLocationByPublicId(
  tx: DbClient,
  tenantId: string,
  locationPublicId: string,
) {
  const [location] = await tx
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.publicId, locationPublicId),
      ),
    )
    .limit(1);

  if (!location) {
    throw new LocationPriceOverrideError(
      "Location not found for this tenant.",
      404,
      "locationPublicId",
    );
  }

  return location;
}

async function buildProductLocationPriceBundle(
  tx: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<ProductLocationPriceBundle | null> {
  const context = await loadDefaultVariantContext(tx, tenantId, productPublicId);
  if (!context) {
    return null;
  }

  const tenantLocations = await listTenantLocations(tx, tenantId);
  const overrideRows = await tx
    .select()
    .from(catalogueVariantLocationPriceOverrides)
    .where(
      and(
        eq(catalogueVariantLocationPriceOverrides.tenantId, tenantId),
        eq(
          catalogueVariantLocationPriceOverrides.variantId,
          context.variant.id,
        ),
        eq(
          catalogueVariantLocationPriceOverrides.currency,
          context.centralPrice.currency,
        ),
      ),
    );

  const overrideByLocationId = new Map(
    overrideRows.map((row) => [row.locationId, row]),
  );

  const central = {
    amountMinor: context.centralPrice.amountMinor,
    currency: context.centralPrice.currency.trim(),
    version: context.centralPrice.version,
  };

  const locationViews = tenantLocations.map((location) => {
    const overrideRow = overrideByLocationId.get(location.id) ?? null;
    const resolved = resolveLocationVariantPrice(
      central,
      overrideRow
        ? {
            amountMinor: overrideRow.amountMinor,
            currency: overrideRow.currency.trim(),
          }
        : null,
    );

    return {
      locationPublicId: location.publicId,
      locationName: location.name,
      currency: resolved.currency,
      amountMinor: resolved.amountMinor,
      inheritanceMode: resolved.inheritanceMode,
      centralPriceVersion: resolved.centralPriceVersion,
      overrideAmountMinor: overrideRow?.amountMinor ?? null,
      canResetToCentral: resolved.inheritanceMode === "override",
    };
  });

  return {
    productPublicId,
    variantPublicId: context.variant.publicId,
    centralAmountMinor: central.amountMinor,
    centralPriceVersion: central.version,
    currency: central.currency,
    canEditPrice: membership.role === "administrator",
    locations: locationViews,
  };
}

export async function getProductLocationPrices(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<ProductLocationPriceBundle> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const bundle = await buildProductLocationPriceBundle(
        tx,
        tenantId,
        membership,
        productPublicId,
      );

      if (!bundle) {
        throw new LocationPriceOverrideError("Product not found.", 404);
      }

      return bundle;
    });
  } catch (error) {
    return mapLocationPriceError(error);
  }
}

type SetLocationPriceOverrideInput = {
  amountMinor: number;
};

export async function setProductLocationPriceOverride(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  productPublicId: string,
  locationPublicId: string,
  input: SetLocationPriceOverrideInput,
): Promise<ProductLocationPriceBundle> {
  try {
    requirePriceEditCapability(membership);

    if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) {
      throw new LocationPriceOverrideError(
        "amountMinor must be a non-negative integer.",
        400,
        "amountMinor",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
      const context = await loadDefaultVariantContext(
        tx,
        tenantId,
        productPublicId,
      );

      if (!context) {
        throw new LocationPriceOverrideError("Product not found.", 404);
      }

      const location = await resolveLocationByPublicId(
        tx,
        tenantId,
        locationPublicId,
      );

      const [existingOverride] = await tx
        .select()
        .from(catalogueVariantLocationPriceOverrides)
        .where(
          and(
            eq(catalogueVariantLocationPriceOverrides.tenantId, tenantId),
            eq(
              catalogueVariantLocationPriceOverrides.variantId,
              context.variant.id,
            ),
            eq(catalogueVariantLocationPriceOverrides.locationId, location.id),
            eq(
              catalogueVariantLocationPriceOverrides.currency,
              context.centralPrice.currency,
            ),
          ),
        )
        .limit(1);

      const now = new Date();

      if (existingOverride) {
        await tx
          .update(catalogueVariantLocationPriceOverrides)
          .set({
            amountMinor: input.amountMinor,
            centralPriceVersionAtOverride: context.centralPrice.version,
            updatedBySubject: staffSubject,
            updatedAt: now,
          })
          .where(eq(catalogueVariantLocationPriceOverrides.id, existingOverride.id));
      } else {
        await tx.insert(catalogueVariantLocationPriceOverrides).values({
          tenantId,
          variantId: context.variant.id,
          locationId: location.id,
          currency: context.centralPrice.currency,
          amountMinor: input.amountMinor,
          centralPriceVersionAtOverride: context.centralPrice.version,
          createdBySubject: staffSubject,
          updatedBySubject: staffSubject,
        });
      }

      const bundle = await buildProductLocationPriceBundle(
        tx,
        tenantId,
        membership,
        productPublicId,
      );

      if (!bundle) {
        throw new LocationPriceOverrideError(
          "Unable to load location prices.",
          500,
        );
      }

      return bundle;
    });
  } catch (error) {
    return mapLocationPriceError(error);
  }
}

export async function resetProductLocationPriceOverride(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  productPublicId: string,
  locationPublicId: string,
): Promise<ProductLocationPriceBundle> {
  try {
    requirePriceEditCapability(membership);

    return await withTenantContext(db, tenantId, async (tx) => {
      const context = await loadDefaultVariantContext(
        tx,
        tenantId,
        productPublicId,
      );

      if (!context) {
        throw new LocationPriceOverrideError("Product not found.", 404);
      }

      const location = await resolveLocationByPublicId(
        tx,
        tenantId,
        locationPublicId,
      );

      const [existingOverride] = await tx
        .select()
        .from(catalogueVariantLocationPriceOverrides)
        .where(
          and(
            eq(catalogueVariantLocationPriceOverrides.tenantId, tenantId),
            eq(
              catalogueVariantLocationPriceOverrides.variantId,
              context.variant.id,
            ),
            eq(catalogueVariantLocationPriceOverrides.locationId, location.id),
            eq(
              catalogueVariantLocationPriceOverrides.currency,
              context.centralPrice.currency,
            ),
          ),
        )
        .limit(1);

      if (!existingOverride) {
        throw new LocationPriceOverrideError(
          "This location already inherits the central price.",
          400,
          "locationPublicId",
        );
      }

      await tx.insert(catalogueVariantLocationPriceResetAudits).values({
        tenantId,
        variantId: context.variant.id,
        locationId: location.id,
        currency: existingOverride.currency,
        previousAmountMinor: existingOverride.amountMinor,
        resetBySubject: staffSubject,
      });

      await tx
        .delete(catalogueVariantLocationPriceOverrides)
        .where(eq(catalogueVariantLocationPriceOverrides.id, existingOverride.id));

      const bundle = await buildProductLocationPriceBundle(
        tx,
        tenantId,
        membership,
        productPublicId,
      );

      if (!bundle) {
        throw new LocationPriceOverrideError(
          "Unable to load location prices.",
          500,
        );
      }

      return bundle;
    });
  } catch (error) {
    return mapLocationPriceError(error);
  }
}
