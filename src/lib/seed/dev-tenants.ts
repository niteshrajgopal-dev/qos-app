import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  brands,
  catalogueModifierGroupTranslations,
  catalogueModifierGroups,
  catalogueModifierOptionTranslations,
  catalogueModifierOptions,
  catalogueProductModifierGroups,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantPrices,
  catalogueVariants,
  locationExternalMenuSources,
  locations,
} from "@/db/schema";
import {
  createTenantHierarchy,
  ensureSeedLocation,
  findTenantByPublicId,
} from "@/lib/tenant/repository";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import {
  FLOWER_TENANT_PUBLIC_ID,
  QUOTES_TENANT_PUBLIC_ID,
  SYNTHETIC_PROVENANCE_NOTE,
} from "@/lib/seed/constants";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { quotesLocationFixtures } from "@/lib/seed/fixtures/quotes-locations";
import { withTenantContext } from "@/lib/tenant/context";

export type SeedDevTenantsResult = {
  quotesTenantId: string;
  flowerTenantId: string;
  quotesLocationIds: string[];
  flowerProductPublicIds: string[];
};

async function ensureExternalMenuSource(
  db: DbClient,
  tenantId: string,
  locationId: string,
  externalMenuId: string,
  sourceUrl: string,
) {
  const [existing] = await db
    .select()
    .from(locationExternalMenuSources)
    .where(
      and(
        eq(locationExternalMenuSources.tenantId, tenantId),
        eq(locationExternalMenuSources.locationId, locationId),
        eq(locationExternalMenuSources.provider, "finedine"),
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(locationExternalMenuSources)
    .values({
      tenantId,
      locationId,
      provider: "finedine",
      externalMenuId,
      sourceUrl,
      provenanceNote: SYNTHETIC_PROVENANCE_NOTE,
    })
    .returning();

  return created;
}

export async function seedQuotesDevTenant(db: DbClient) {
  let tenant = await findTenantByPublicId(db, QUOTES_TENANT_PUBLIC_ID);
  let brandId: string;

  if (!tenant) {
    const created = await createTenantHierarchy(db, quotesTenantFixture());
    tenant = created.tenant;
    brandId = created.brand.id;
  } else {
    const [brand] = await db
      .select()
      .from(brands)
      .where(
        and(eq(brands.tenantId, tenant.id), eq(brands.publicId, "brd_quotes")),
      )
      .limit(1);

    if (!brand) {
      throw new Error("Quotes brand fixture is missing.");
    }

    brandId = brand.id;
  }

  const seededLocations = [];

  for (const locationFixture of quotesLocationFixtures) {
    const location = await ensureSeedLocation(db, {
      tenantId: tenant.id,
      brandId,
      publicId: locationFixture.publicId,
      name: locationFixture.name,
      slug: locationFixture.slug,
      timezone: locationFixture.timezone,
    });

    await ensureExternalMenuSource(
      db,
      tenant.id,
      location.id,
      locationFixture.externalMenuId,
      locationFixture.sourceUrl,
    );

    seededLocations.push(location);
  }

  return {
    tenantId: tenant.id,
    locationIds: seededLocations.map((location) => location.id),
  };
}

async function ensureFlowerCatalogue(db: DbClient, tenantId: string, brandId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const fixture = flowerRoseBouquetFixture;

    let [product] = await tx
      .select()
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.publicId, fixture.productPublicId),
        ),
      )
      .limit(1);

    if (!product) {
      [product] = await tx
        .insert(catalogueProducts)
        .values({
          tenantId,
          brandId,
          publicId: fixture.productPublicId,
          internalName: fixture.internalName,
          status: "active",
          provenance: "synthetic_fixture",
        })
        .returning();
    }

    for (const [locale, translation] of Object.entries(fixture.translations)) {
      const [existingTranslation] = await tx
        .select()
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, tenantId),
            eq(catalogueProductTranslations.productId, product.id),
            eq(catalogueProductTranslations.locale, locale),
          ),
        )
        .limit(1);

      if (!existingTranslation) {
        await tx.insert(catalogueProductTranslations).values({
          tenantId,
          productId: product.id,
          locale,
          displayName: translation.displayName,
          description: translation.description,
        });
      }
    }

    for (const variantFixture of fixture.variants) {
      let [variant] = await tx
        .select()
        .from(catalogueVariants)
        .where(
          and(
            eq(catalogueVariants.tenantId, tenantId),
            eq(catalogueVariants.publicId, variantFixture.publicId),
          ),
        )
        .limit(1);

      if (!variant) {
        [variant] = await tx
          .insert(catalogueVariants)
          .values({
            tenantId,
            productId: product.id,
            publicId: variantFixture.publicId,
            isDefault: variantFixture.isDefault,
            sortOrder: variantFixture.sortOrder,
          })
          .returning();
      }

      const [existingPrice] = await tx
        .select()
        .from(catalogueVariantPrices)
        .where(
          and(
            eq(catalogueVariantPrices.tenantId, tenantId),
            eq(catalogueVariantPrices.variantId, variant.id),
            eq(catalogueVariantPrices.currency, "AED"),
          ),
        )
        .limit(1);

      if (!existingPrice) {
        await tx.insert(catalogueVariantPrices).values({
          tenantId,
          variantId: variant.id,
          currency: "AED",
          amountMinor: variantFixture.amountMinor,
        });
      }
    }

    let [modifierGroup] = await tx
      .select()
      .from(catalogueModifierGroups)
      .where(
        and(
          eq(catalogueModifierGroups.tenantId, tenantId),
          eq(catalogueModifierGroups.publicId, fixture.modifierGroup.publicId),
        ),
      )
      .limit(1);

    if (!modifierGroup) {
      [modifierGroup] = await tx
        .insert(catalogueModifierGroups)
        .values({
          tenantId,
          publicId: fixture.modifierGroup.publicId,
          internalName: fixture.modifierGroup.internalName,
          minSelections: fixture.modifierGroup.minSelections,
          maxSelections: fixture.modifierGroup.maxSelections,
          provenance: "synthetic_fixture",
        })
        .returning();
    }

    for (const [locale, displayName] of Object.entries(
      fixture.modifierGroup.translations,
    )) {
      const [existingGroupTranslation] = await tx
        .select()
        .from(catalogueModifierGroupTranslations)
        .where(
          and(
            eq(catalogueModifierGroupTranslations.tenantId, tenantId),
            eq(
              catalogueModifierGroupTranslations.modifierGroupId,
              modifierGroup.id,
            ),
            eq(catalogueModifierGroupTranslations.locale, locale),
          ),
        )
        .limit(1);

      if (!existingGroupTranslation) {
        await tx.insert(catalogueModifierGroupTranslations).values({
          tenantId,
          modifierGroupId: modifierGroup.id,
          locale,
          displayName,
        });
      }
    }

    for (const optionFixture of fixture.modifierGroup.options) {
      let [option] = await tx
        .select()
        .from(catalogueModifierOptions)
        .where(
          and(
            eq(catalogueModifierOptions.tenantId, tenantId),
            eq(catalogueModifierOptions.publicId, optionFixture.publicId),
          ),
        )
        .limit(1);

      if (!option) {
        [option] = await tx
          .insert(catalogueModifierOptions)
          .values({
            tenantId,
            modifierGroupId: modifierGroup.id,
            publicId: optionFixture.publicId,
            sortOrder: optionFixture.sortOrder,
            priceMinor: optionFixture.priceMinor,
            currency: "AED",
          })
          .returning();
      }

      for (const [locale, displayName] of Object.entries(
        optionFixture.translations,
      )) {
        const [existingOptionTranslation] = await tx
          .select()
          .from(catalogueModifierOptionTranslations)
          .where(
            and(
              eq(catalogueModifierOptionTranslations.tenantId, tenantId),
              eq(
                catalogueModifierOptionTranslations.modifierOptionId,
                option.id,
              ),
              eq(catalogueModifierOptionTranslations.locale, locale),
            ),
          )
          .limit(1);

        if (!existingOptionTranslation) {
          await tx.insert(catalogueModifierOptionTranslations).values({
            tenantId,
            modifierOptionId: option.id,
            locale,
            displayName,
          });
        }
      }
    }

    const [existingLink] = await tx
      .select()
      .from(catalogueProductModifierGroups)
      .where(
        and(
          eq(catalogueProductModifierGroups.tenantId, tenantId),
          eq(catalogueProductModifierGroups.productId, product.id),
          eq(catalogueProductModifierGroups.modifierGroupId, modifierGroup.id),
        ),
      )
      .limit(1);

    if (!existingLink) {
      await tx.insert(catalogueProductModifierGroups).values({
        tenantId,
        productId: product.id,
        modifierGroupId: modifierGroup.id,
        sortOrder: 0,
      });
    }

    return [fixture.productPublicId];
  });
}

export async function seedFlowerDevTenant(db: DbClient) {
  let tenant = await findTenantByPublicId(db, FLOWER_TENANT_PUBLIC_ID);
  let brandId: string;

  if (!tenant) {
    const created = await createTenantHierarchy(db, flowerTenantFixture());
    tenant = created.tenant;
    brandId = created.brand.id;
  } else {
    const [brand] = await db
      .select()
      .from(brands)
      .where(
        and(eq(brands.tenantId, tenant.id), eq(brands.publicId, "brd_flowers")),
      )
      .limit(1);

    if (!brand) {
      throw new Error("Flower brand fixture is missing.");
    }

    brandId = brand.id;
  }

  await ensureSeedLocation(db, {
    tenantId: tenant.id,
    brandId,
    publicId: flowerTenantFixture().location.publicId,
    name: flowerTenantFixture().location.name,
    slug: flowerTenantFixture().location.slug,
    timezone: flowerTenantFixture().location.timezone,
  });

  const productPublicIds = await ensureFlowerCatalogue(db, tenant.id, brandId);

  return {
    tenantId: tenant.id,
    productPublicIds,
  };
}

export async function seedDevTenants(db: DbClient): Promise<SeedDevTenantsResult> {
  const quotes = await seedQuotesDevTenant(db);
  const flowers = await seedFlowerDevTenant(db);

  return {
    quotesTenantId: quotes.tenantId,
    flowerTenantId: flowers.tenantId,
    quotesLocationIds: quotes.locationIds,
    flowerProductPublicIds: flowers.productPublicIds,
  };
}

export async function resetSyntheticCatalogueForTenant(
  db: DbClient,
  tenantId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const syntheticProducts = await tx
      .select({ id: catalogueProducts.id })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.provenance, "synthetic_fixture"),
        ),
      );

    const productIds = syntheticProducts.map((product) => product.id);

    if (productIds.length > 0) {
      await tx
        .delete(catalogueProductModifierGroups)
        .where(
          and(
            eq(catalogueProductModifierGroups.tenantId, tenantId),
            inArray(catalogueProductModifierGroups.productId, productIds),
          ),
        );

      await tx
        .delete(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, tenantId),
            inArray(catalogueProductTranslations.productId, productIds),
          ),
        );

      const variants = await tx
        .select({ id: catalogueVariants.id })
        .from(catalogueVariants)
        .where(
          and(
            eq(catalogueVariants.tenantId, tenantId),
            inArray(catalogueVariants.productId, productIds),
          ),
        );

      const variantIds = variants.map((variant) => variant.id);

      if (variantIds.length > 0) {
        await tx
          .delete(catalogueVariantPrices)
          .where(
            and(
              eq(catalogueVariantPrices.tenantId, tenantId),
              inArray(catalogueVariantPrices.variantId, variantIds),
            ),
          );

        await tx
          .delete(catalogueVariants)
          .where(
            and(
              eq(catalogueVariants.tenantId, tenantId),
              inArray(catalogueVariants.id, variantIds),
            ),
          );
      }

      await tx
        .delete(catalogueProducts)
        .where(
          and(
            eq(catalogueProducts.tenantId, tenantId),
            inArray(catalogueProducts.id, productIds),
          ),
        );
    }

    const syntheticGroups = await tx
      .select({ id: catalogueModifierGroups.id })
      .from(catalogueModifierGroups)
      .where(
        and(
          eq(catalogueModifierGroups.tenantId, tenantId),
          eq(catalogueModifierGroups.provenance, "synthetic_fixture"),
        ),
      );

    const groupIds = syntheticGroups.map((group) => group.id);

    if (groupIds.length > 0) {
      const options = await tx
        .select({ id: catalogueModifierOptions.id })
        .from(catalogueModifierOptions)
        .where(
          and(
            eq(catalogueModifierOptions.tenantId, tenantId),
            inArray(catalogueModifierOptions.modifierGroupId, groupIds),
          ),
        );

      const optionIds = options.map((option) => option.id);

      if (optionIds.length > 0) {
        await tx
          .delete(catalogueModifierOptionTranslations)
          .where(
            and(
              eq(catalogueModifierOptionTranslations.tenantId, tenantId),
              inArray(
                catalogueModifierOptionTranslations.modifierOptionId,
                optionIds,
              ),
            ),
          );

        await tx
          .delete(catalogueModifierOptions)
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              inArray(catalogueModifierOptions.id, optionIds),
            ),
          );
      }

      await tx
        .delete(catalogueModifierGroupTranslations)
        .where(
          and(
            eq(catalogueModifierGroupTranslations.tenantId, tenantId),
            inArray(
              catalogueModifierGroupTranslations.modifierGroupId,
              groupIds,
            ),
          ),
        );

      await tx
        .delete(catalogueModifierGroups)
        .where(
          and(
            eq(catalogueModifierGroups.tenantId, tenantId),
            inArray(catalogueModifierGroups.id, groupIds),
          ),
        );
    }
  });
}

export async function listQuotesExternalMenuMappings(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    return tx
      .select({
        locationPublicId: locations.publicId,
        locationName: locations.name,
        externalMenuId: locationExternalMenuSources.externalMenuId,
        sourceUrl: locationExternalMenuSources.sourceUrl,
        provenanceNote: locationExternalMenuSources.provenanceNote,
      })
      .from(locationExternalMenuSources)
      .innerJoin(
        locations,
        and(
          eq(locations.tenantId, tenantId),
          eq(locations.id, locationExternalMenuSources.locationId),
        ),
      )
      .where(eq(locationExternalMenuSources.tenantId, tenantId))
      .orderBy(locations.publicId);
  });
}
