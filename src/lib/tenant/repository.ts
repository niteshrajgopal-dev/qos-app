import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import type { TenantDbExecutor } from "@/lib/tenant/context";
import {
  brands,
  locations,
  organizations,
  tenants,
} from "@/db/schema";
import {
  CreateTenantHierarchyInput,
  TenantValidationError,
} from "@/lib/tenant/types";

function assertNonEmpty(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new TenantValidationError(`${field} is required.`);
  }
}

export function validateCreateTenantHierarchyInput(
  input: CreateTenantHierarchyInput,
) {
  assertNonEmpty(input.tenant.publicId, "tenant.publicId");
  assertNonEmpty(input.tenant.name, "tenant.name");
  assertNonEmpty(input.tenant.businessProfile, "tenant.businessProfile");
  assertNonEmpty(input.tenant.baseCurrency, "tenant.baseCurrency");
  assertNonEmpty(input.tenant.defaultLocale, "tenant.defaultLocale");
  assertNonEmpty(input.tenant.defaultTimezone, "tenant.defaultTimezone");
  assertNonEmpty(input.organization.publicId, "organization.publicId");
  assertNonEmpty(input.organization.name, "organization.name");
  assertNonEmpty(input.brand.publicId, "brand.publicId");
  assertNonEmpty(input.brand.name, "brand.name");
  assertNonEmpty(input.location.publicId, "location.publicId");
  assertNonEmpty(input.location.name, "location.name");
  assertNonEmpty(input.location.slug, "location.slug");
  assertNonEmpty(input.location.timezone, "location.timezone");

  if (input.tenant.baseCurrency.trim().length !== 3) {
    throw new TenantValidationError("tenant.baseCurrency must be a 3-letter code.");
  }
}

export async function createTenantHierarchy(
  db: DbClient,
  input: CreateTenantHierarchyInput,
) {
  validateCreateTenantHierarchyInput(input);

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        publicId: input.tenant.publicId.trim(),
        name: input.tenant.name.trim(),
        businessProfile: input.tenant.businessProfile,
        baseCurrency: input.tenant.baseCurrency.trim().toUpperCase(),
        defaultLocale: input.tenant.defaultLocale.trim(),
        defaultTimezone: input.tenant.defaultTimezone.trim(),
        supportedLocales: input.tenant.supportedLocales ?? ["en", "ar"],
      })
      .returning();

    const [organization] = await tx
      .insert(organizations)
      .values({
        tenantId: tenant.id,
        publicId: input.organization.publicId.trim(),
        name: input.organization.name.trim(),
        isDefault: true,
      })
      .returning();

    const [brand] = await tx
      .insert(brands)
      .values({
        tenantId: tenant.id,
        organizationId: organization.id,
        publicId: input.brand.publicId.trim(),
        name: input.brand.name.trim(),
      })
      .returning();

    const [location] = await tx
      .insert(locations)
      .values({
        tenantId: tenant.id,
        brandId: brand.id,
        publicId: input.location.publicId.trim(),
        name: input.location.name.trim(),
        slug: input.location.slug.trim(),
        timezone: input.location.timezone.trim(),
      })
      .returning();

    return { tenant, organization, brand, location };
  });
}

export type EnsureSeedLocationInput = {
  tenantId: string;
  brandId: string;
  publicId: string;
  name: string;
  slug: string;
  timezone: string;
};

export async function ensureSeedLocation(
  db: DbClient,
  input: EnsureSeedLocationInput,
) {
  const [existing] = await db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, input.tenantId),
        eq(locations.publicId, input.publicId),
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const [location] = await db
    .insert(locations)
    .values({
      tenantId: input.tenantId,
      brandId: input.brandId,
      publicId: input.publicId.trim(),
      name: input.name.trim(),
      slug: input.slug.trim(),
      timezone: input.timezone.trim(),
    })
    .returning();

  return location;
}

export async function findTenantByPublicId(db: DbClient, publicId: string) {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.publicId, publicId))
    .limit(1);

  return tenant ?? null;
}

export async function findTenantById(db: DbClient, tenantId: string) {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return tenant ?? null;
}

export async function listTenantLocations(
  db: TenantDbExecutor,
  tenantId: string,
) {
  return db
    .select()
    .from(locations)
    .where(eq(locations.tenantId, tenantId));
}

export async function updateLocationName(
  db: TenantDbExecutor,
  tenantId: string,
  locationId: string,
  name: string,
) {
  const [updated] = await db
    .update(locations)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .returning();

  return updated ?? null;
}

export async function deleteTenant(db: TenantDbExecutor, tenantId: string) {
  return db.delete(tenants).where(eq(tenants.id, tenantId)).returning();
}
