import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { brands, locations, tenants } from "@/db/schema";
import { recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import {
  buildPublicId,
  slugify,
  OnboardingValidationError,
} from "@/lib/onboarding/validation";
import { withTenantContext } from "@/lib/tenant/context";

export type AddLocationInput = {
  tenantId: string;
  brandId: string;
  name: string;
  timezone: string;
};

export function validateAddLocationInput(input: AddLocationInput) {
  if (!input.tenantId.trim()) {
    throw new OnboardingValidationError("tenantId is required.");
  }
  if (!input.brandId.trim()) {
    throw new OnboardingValidationError("brandId is required.");
  }
  if (!input.name.trim()) {
    throw new OnboardingValidationError("name is required.");
  }
  if (!input.timezone.trim()) {
    throw new OnboardingValidationError("timezone is required.");
  }

  const slug = slugify(input.name);
  if (!slug) {
    throw new OnboardingValidationError("name must produce a valid slug.");
  }

  return {
    tenantId: input.tenantId.trim(),
    brandId: input.brandId.trim(),
    name: input.name.trim(),
    timezone: input.timezone.trim(),
    slug,
  };
}

export async function addTenantLocation(
  db: DbClient,
  input: AddLocationInput,
  operatorSubject: string,
) {
  const normalized = validateAddLocationInput(input);

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, normalized.tenantId))
    .limit(1);

  if (!tenant) {
    throw new OnboardingValidationError("Tenant not found.");
  }

  const [brand] = await db
    .select()
    .from(brands)
    .where(
      and(
        eq(brands.id, normalized.brandId),
        eq(brands.tenantId, normalized.tenantId),
      ),
    )
    .limit(1);

  if (!brand) {
    throw new OnboardingValidationError(
      "Brand not found for the requested tenant.",
    );
  }

  const location = await withTenantContext(db, normalized.tenantId, async (tx) => {
    const [created] = await tx
      .insert(locations)
      .values({
        tenantId: normalized.tenantId,
        brandId: normalized.brandId,
        publicId: buildPublicId("loc", normalized.name),
        name: normalized.name,
        slug: normalized.slug,
        timezone: normalized.timezone,
      })
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId: normalized.tenantId,
      locationId: created.id,
      actorSubject: operatorSubject,
      actorClass: "operator",
      action: "platform.location.add",
      entityType: "location",
      entityPublicId: created.publicId,
      changeSummary: {
        name: created.name,
        slug: created.slug,
        timezone: created.timezone,
        brandId: normalized.brandId,
      },
    });

    return created;
  });

  return location;
}
