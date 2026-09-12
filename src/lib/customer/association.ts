import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  storefrontCustomerAssociations,
  storefrontDomains,
  storefronts,
  tenants,
} from "@/db/schema";
import { CustomerAuthError } from "@/lib/customer/session";
import { normalizeIncomingHost } from "@/lib/storefront/host-resolution";
import { withTenantContext } from "@/lib/tenant/context";

export class CustomerAssociationError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 403, field?: string) {
    super(message);
    this.name = "CustomerAssociationError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

type StorefrontBinding = {
  tenantId: string;
  tenantPublicId: string;
  storefrontId: string;
  storefrontPublicId: string;
};

async function resolveStorefrontBindingByHost(
  db: DbClient,
  hostnameInput: string,
): Promise<StorefrontBinding> {
  const hostname = normalizeIncomingHost(hostnameInput);

  const [domain] = await db
    .select({
      tenantId: storefrontDomains.tenantId,
      storefrontId: storefrontDomains.storefrontId,
    })
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, hostname))
    .limit(1);

  if (!domain) {
    throw new CustomerAssociationError(
      "Storefront host is not configured.",
      404,
      "host",
    );
  }

  return withTenantContext(db, domain.tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        id: storefronts.id,
        publicId: storefronts.publicId,
        status: storefronts.status,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, domain.tenantId),
          eq(storefronts.id, domain.storefrontId),
        ),
      )
      .limit(1);

    if (!storefront || storefront.status === "archived") {
      throw new CustomerAssociationError(
        "Storefront host is not configured.",
        404,
        "host",
      );
    }

    const [tenant] = await tx
      .select({ publicId: tenants.publicId })
      .from(tenants)
      .where(eq(tenants.id, domain.tenantId))
      .limit(1);

    if (!tenant) {
      throw new CustomerAssociationError(
        "Storefront host is not configured.",
        404,
        "host",
      );
    }

    return {
      tenantId: domain.tenantId,
      tenantPublicId: tenant.publicId,
      storefrontId: storefront.id,
      storefrontPublicId: storefront.publicId,
    };
  });
}

export async function ensureStorefrontCustomerAssociation(
  db: DbClient,
  input: {
    hostname: string;
    customerUserId: string;
    phone?: string | null;
  },
) {
  const binding = await resolveStorefrontBindingByHost(db, input.hostname);

  return withTenantContext(db, binding.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(storefrontCustomerAssociations)
      .where(
        and(
          eq(storefrontCustomerAssociations.tenantId, binding.tenantId),
          eq(
            storefrontCustomerAssociations.customerUserId,
            input.customerUserId,
          ),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.storefrontId !== binding.storefrontId) {
        throw new CustomerAssociationError(
          "Customer is already associated with another storefront in this tenant.",
          403,
          "storefrontPublicId",
        );
      }

      if (existing.status === "suspended") {
        throw new CustomerAssociationError(
          "Customer association is suspended.",
          403,
          "associationStatus",
        );
      }

      return {
        binding,
        association: existing,
      };
    }

    const [created] = await tx
      .insert(storefrontCustomerAssociations)
      .values({
        tenantId: binding.tenantId,
        storefrontId: binding.storefrontId,
        customerUserId: input.customerUserId,
        phone: input.phone?.trim() || null,
      })
      .returning();

    return {
      binding,
      association: created,
    };
  });
}

export async function getCurrentStorefrontCustomer(
  db: DbClient,
  input: {
    hostname: string;
    customerUserId: string;
    email: string;
    name: string;
    emailVerified: boolean;
  },
) {
  if (!input.emailVerified) {
    throw new CustomerAuthError(
      "Verified email is required.",
      401,
      "emailVerified",
    );
  }

  const { binding, association } = await ensureStorefrontCustomerAssociation(
    db,
    {
      hostname: input.hostname,
      customerUserId: input.customerUserId,
    },
  );

  return {
    tenantPublicId: binding.tenantPublicId,
    storefrontPublicId: binding.storefrontPublicId,
    phone: association.phone,
    associationStatus: association.status,
  };
}
