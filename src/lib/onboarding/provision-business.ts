import { eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  brands,
  businessProvisioningOperations,
  locations,
  organizations,
  staffInvitationLocations,
  staffInvitations,
  staffMemberships,
  tenants,
} from "@/db/schema";
import {
  buildStaffInvitationExpiry,
  generateStaffInvitationToken,
} from "@/lib/staff/invitations";
import type { OperatorIdentity } from "@/lib/platform/operator-auth";
import {
  buildPublicId,
  normalizeProvisionBusinessInput,
  slugify,
  type ProvisionBusinessInput,
} from "@/lib/onboarding/validation";
import {
  deriveDefaultStorefrontSlug,
  previewDefaultPlatformHostname,
  provisionDefaultStorefront,
} from "@/lib/storefront/provision-default-storefront";
import { setTenantContext } from "@/lib/tenant/context";

export type ProvisionBusinessPreview = {
  businessName: string;
  businessProfile: ProvisionBusinessInput["businessProfile"];
  brandName: string;
  locationName: string;
  locationTimezone: string;
  administratorEmail: string;
  baseCurrency: string;
  defaultLocale: string;
  supportedLocales: string[];
  administratorRole: NonNullable<ProvisionBusinessInput["administratorRole"]>;
  derivedLocationSlug: string;
  derivedStorefrontSlug: string;
  proposedPlatformHostname: string;
  platformDomainSuffix: string;
};

export type ProvisionBusinessResult = {
  operationId: string;
  idempotencyKey: string;
  tenant: {
    id: string;
    publicId: string;
    name: string;
    status: string;
  };
  organization: { id: string; publicId: string; name: string };
  brand: { id: string; publicId: string; name: string };
  location: { id: string; publicId: string; name: string; slug: string };
  invitation: {
    id: string;
    email: string;
    role: string;
    status: string;
    deliveryStatus: string;
  };
  storefront: {
    publicId: string;
    slug: string;
    status: "draft" | "active" | "archived";
  };
  platformDomain: {
    hostname: string;
    lifecycleStatus: "provisioning" | "active" | "inactive";
    verificationStatus: "pending" | "verified" | "failed";
    collisionSuffix: string | null;
  };
  onboardingStatus: {
    businessReady: true;
    storefrontDraftReady: true;
    platformAddress: {
      hostname: string;
      lifecycleStatus: "provisioning" | "active" | "inactive";
      verificationStatus: "pending" | "verified" | "failed";
    };
    customDomainOptional: true;
  };
  provisionedByOperatorId: string;
  idempotentReplay: boolean;
};

export function previewProvisionBusiness(
  input: ProvisionBusinessInput,
): ProvisionBusinessPreview {
  const normalized = normalizeProvisionBusinessInput(input);

  const platformPreview = previewDefaultPlatformHostname(normalized.brandName);

  return {
    businessName: normalized.businessName,
    businessProfile: normalized.businessProfile,
    brandName: normalized.brandName,
    locationName: normalized.locationName,
    locationTimezone: normalized.locationTimezone,
    administratorEmail: normalized.administratorEmail,
    baseCurrency: normalized.baseCurrency,
    defaultLocale: normalized.defaultLocale,
    supportedLocales: normalized.supportedLocales,
    administratorRole: normalized.administratorRole ?? "administrator",
    derivedLocationSlug: slugify(normalized.locationName),
    derivedStorefrontSlug: deriveDefaultStorefrontSlug(normalized.brandName),
    proposedPlatformHostname: platformPreview.proposedHostname,
    platformDomainSuffix: platformPreview.platformDomainSuffix,
  };
}

function parseStoredResult(snapshot: string | null): ProvisionBusinessResult | null {
  if (!snapshot) {
    return null;
  }

  return JSON.parse(snapshot) as ProvisionBusinessResult;
}

async function findProvisioningOperation(db: DbClient, idempotencyKey: string) {
  const [existing] = await db
    .select()
    .from(businessProvisioningOperations)
    .where(eq(businessProvisioningOperations.idempotencyKey, idempotencyKey))
    .limit(1);

  return existing ?? null;
}

export async function provisionBusiness(
  db: DbClient,
  operator: OperatorIdentity,
  idempotencyKey: string,
  input: ProvisionBusinessInput,
): Promise<ProvisionBusinessResult> {
  const normalized = normalizeProvisionBusinessInput(input);
  const preview = previewProvisionBusiness(normalized);
  const trimmedKey = idempotencyKey.trim();

  if (!trimmedKey) {
    throw new Error("Idempotency-Key is required.");
  }

  const existing = await findProvisioningOperation(db, trimmedKey);
  if (existing?.status === "completed") {
    const replay = parseStoredResult(existing.resultSnapshot);
    if (replay) {
      return { ...replay, idempotentReplay: true };
    }
  }

  if (existing?.status === "pending") {
    throw new Error("Provisioning operation is already in progress.");
  }

  return db.transaction(async (tx) => {
    const [operation] = await tx
      .insert(businessProvisioningOperations)
      .values({
        idempotencyKey: trimmedKey,
        operatorSubject: operator.subject,
        status: "pending",
      })
      .onConflictDoNothing({
        target: businessProvisioningOperations.idempotencyKey,
      })
      .returning();

    if (!operation) {
      const replayOperation = await findProvisioningOperation(tx, trimmedKey);
      if (replayOperation?.status === "completed") {
        const replay = parseStoredResult(replayOperation.resultSnapshot);
        if (replay) {
          return { ...replay, idempotentReplay: true };
        }
      }

      throw new Error("Provisioning operation conflict.");
    }

    const tenantPublicId = buildPublicId("ten", normalized.businessName);
    const organizationPublicId = buildPublicId("org", normalized.businessName);
    const brandPublicId = buildPublicId("brd", normalized.brandName);
    const locationPublicId = buildPublicId("loc", normalized.locationName);
    const locationSlug = preview.derivedLocationSlug;

    if (!locationSlug) {
      throw new Error("locationName must produce a valid slug.");
    }

    const [tenant] = await tx
      .insert(tenants)
      .values({
        publicId: tenantPublicId,
        name: normalized.businessName,
        businessProfile: normalized.businessProfile,
        baseCurrency: normalized.baseCurrency,
        defaultLocale: normalized.defaultLocale,
        defaultTimezone: normalized.locationTimezone,
        supportedLocales: normalized.supportedLocales,
        provisionedByOperatorId: operator.subject,
      })
      .returning();

    const [organization] = await tx
      .insert(organizations)
      .values({
        tenantId: tenant.id,
        publicId: organizationPublicId,
        name: `${normalized.businessName} Organization`,
        isDefault: true,
      })
      .returning();

    const [brand] = await tx
      .insert(brands)
      .values({
        tenantId: tenant.id,
        organizationId: organization.id,
        publicId: brandPublicId,
        name: normalized.brandName,
      })
      .returning();

    const [location] = await tx
      .insert(locations)
      .values({
        tenantId: tenant.id,
        brandId: brand.id,
        publicId: locationPublicId,
        name: normalized.locationName,
        slug: locationSlug,
        timezone: normalized.locationTimezone,
      })
      .returning();

    const { token, tokenHash } = generateStaffInvitationToken();
    const expiresAt = buildStaffInvitationExpiry();

    const [invitation] = await tx
      .insert(staffInvitations)
      .values({
        tenantId: tenant.id,
        email: normalized.administratorEmail,
        role: normalized.administratorRole ?? "administrator",
        invitedByOperatorId: operator.subject,
        tokenHash,
        expiresAt,
      })
      .returning();

    await tx.insert(staffInvitationLocations).values({
      tenantId: tenant.id,
      invitationId: invitation.id,
      locationId: location.id,
    });

    console.info(
      JSON.stringify({
        type: "staff_invitation_created",
        tenantId: tenant.id,
        invitationId: invitation.id,
        email: normalized.administratorEmail,
        expiresAt: expiresAt.toISOString(),
        invitationToken: token,
      }),
    );

    const memberships = await tx
      .select()
      .from(staffMemberships)
      .where(eq(staffMemberships.tenantId, tenant.id));

    if (memberships.length > 0) {
      throw new Error("Pending invitation must not create staff membership.");
    }

    await setTenantContext(tx, tenant.id);

    const defaultStorefront = await provisionDefaultStorefront(tx, {
      tenantId: tenant.id,
      brandId: brand.id,
      brandName: normalized.brandName,
      businessProfile: normalized.businessProfile,
      locationId: location.id,
      locationPublicId: location.publicId,
      defaultLocale: normalized.defaultLocale,
      supportedLocales: normalized.supportedLocales,
    });

    const result: ProvisionBusinessResult = {
      operationId: operation.id,
      idempotencyKey: trimmedKey,
      tenant: {
        id: tenant.id,
        publicId: tenant.publicId,
        name: tenant.name,
        status: tenant.status,
      },
      organization: {
        id: organization.id,
        publicId: organization.publicId,
        name: organization.name,
      },
      brand: {
        id: brand.id,
        publicId: brand.publicId,
        name: brand.name,
      },
      location: {
        id: location.id,
        publicId: location.publicId,
        name: location.name,
        slug: location.slug,
      },
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        deliveryStatus: invitation.deliveryStatus,
      },
      storefront: {
        publicId: defaultStorefront.storefront.publicId,
        slug: defaultStorefront.storefront.slug,
        status: defaultStorefront.storefront.status,
      },
      platformDomain: {
        hostname: defaultStorefront.domain.hostname,
        lifecycleStatus: defaultStorefront.domain.lifecycleStatus,
        verificationStatus: defaultStorefront.domain.verificationStatus,
        collisionSuffix: defaultStorefront.domain.collisionSuffix,
      },
      onboardingStatus: defaultStorefront.onboardingStatus,
      provisionedByOperatorId: operator.subject,
      idempotentReplay: false,
    };

    await tx
      .update(businessProvisioningOperations)
      .set({
        status: "completed",
        tenantId: tenant.id,
        resultSnapshot: JSON.stringify(result),
        updatedAt: new Date(),
      })
      .where(eq(businessProvisioningOperations.id, operation.id));

    return result;
  });
}
