import { desc, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenus,
  customerAuthUsers,
  storefrontCheckoutPaymentAttempts,
  storefrontCustomerAssociations,
  storefronts,
  tenants,
} from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";

export {
  formatMinorCurrency,
  staffStripeIntegrationView,
} from "@/lib/staff/workspace-view";

export async function listStaffOrders(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    return tx
      .select({
        publicId: storefrontCheckoutPaymentAttempts.publicId,
        status: storefrontCheckoutPaymentAttempts.status,
        amountMinor: storefrontCheckoutPaymentAttempts.amountMinor,
        currency: storefrontCheckoutPaymentAttempts.currency,
        provider: storefrontCheckoutPaymentAttempts.provider,
        createdAt: storefrontCheckoutPaymentAttempts.createdAt,
        customerEmail: customerAuthUsers.email,
        customerName: customerAuthUsers.name,
      })
      .from(storefrontCheckoutPaymentAttempts)
      .innerJoin(
        customerAuthUsers,
        eq(customerAuthUsers.id, storefrontCheckoutPaymentAttempts.customerUserId),
      )
      .where(eq(storefrontCheckoutPaymentAttempts.tenantId, tenantId))
      .orderBy(desc(storefrontCheckoutPaymentAttempts.createdAt))
      .limit(50);
  });
}

export async function listStaffCustomers(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    return tx
      .select({
        customerUserId: storefrontCustomerAssociations.customerUserId,
        status: storefrontCustomerAssociations.status,
        createdAt: storefrontCustomerAssociations.createdAt,
        email: customerAuthUsers.email,
        name: customerAuthUsers.name,
        emailVerified: customerAuthUsers.emailVerified,
        storefrontName: storefronts.internalName,
      })
      .from(storefrontCustomerAssociations)
      .innerJoin(
        customerAuthUsers,
        eq(customerAuthUsers.id, storefrontCustomerAssociations.customerUserId),
      )
      .innerJoin(
        storefronts,
        eq(storefronts.id, storefrontCustomerAssociations.storefrontId),
      )
      .where(eq(storefrontCustomerAssociations.tenantId, tenantId))
      .orderBy(desc(storefrontCustomerAssociations.createdAt))
      .limit(50);
  });
}

export async function getStaffAnalytics(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [payments] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${storefrontCheckoutPaymentAttempts.status} = 'succeeded')::int`,
        failed: sql<number>`count(*) filter (where ${storefrontCheckoutPaymentAttempts.status} = 'failed')::int`,
      })
      .from(storefrontCheckoutPaymentAttempts)
      .where(eq(storefrontCheckoutPaymentAttempts.tenantId, tenantId));

    const [customers] = await tx
      .select({
        total: sql<number>`count(*)::int`,
      })
      .from(storefrontCustomerAssociations)
      .where(eq(storefrontCustomerAssociations.tenantId, tenantId));

    const [menus] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        live: sql<number>`count(*) filter (where ${catalogueMenus.publishedVersion} is not null)::int`,
      })
      .from(catalogueMenus)
      .where(eq(catalogueMenus.tenantId, tenantId));

    return {
      paymentAttempts: payments?.total ?? 0,
      succeededPayments: payments?.succeeded ?? 0,
      failedPayments: payments?.failed ?? 0,
      customers: customers?.total ?? 0,
      menus: menus?.total ?? 0,
      liveMenus: menus?.live ?? 0,
    };
  });
}

export async function getStaffSettings(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({
        publicId: tenants.publicId,
        name: tenants.name,
        status: tenants.status,
        businessProfile: tenants.businessProfile,
        baseCurrency: tenants.baseCurrency,
        defaultLocale: tenants.defaultLocale,
        defaultTimezone: tenants.defaultTimezone,
        supportedLocales: tenants.supportedLocales,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    return tenant ?? null;
  });
}
