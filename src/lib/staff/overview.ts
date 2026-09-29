import { eq, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenus,
  catalogueProducts,
  locations,
  storefrontCheckoutPaymentAttempts,
  storefronts,
  tenants,
} from "@/db/schema";
import { listTenantAuditEventsInTx } from "@/lib/audit/tenant-audit";
import type { TenantAuditEventView } from "@/lib/audit/tenant-audit";
import { withTenantContext } from "@/lib/tenant/context";

export type TenantOverviewBranch = {
  publicId: string;
  name: string;
  timezone: string;
  status: "active" | "inactive" | "archived" | string;
};

export type TenantOverview = {
  currency: string;
  timezone: string;
  payments: {
    /** Captured payments since midnight in the business timezone. */
    capturedToday: number;
    revenueMinorToday: number;
    succeeded: number;
    attempts: number;
    /** Share of all payment attempts that were captured, or null when none exist. */
    captureRate: number | null;
  };
  menus: { total: number; live: number };
  locations: { total: number; active: number };
  storefronts: { total: number; live: number };
  products: { total: number };
  /** Audit trail is administrator-only, so this is empty for staff users. */
  activity: TenantAuditEventView[];
};

/** Whole-percentage share, or null when there is nothing to divide by. */
export function sharePercent(part: number, whole: number): number | null {
  if (whole <= 0) {
    return null;
  }

  return Math.round((part / whole) * 100);
}

/** Minor units to a grouped major-unit string, e.g. 2486000 -> "24,860.00". */
export function formatMinorAmount(amountMinor: number, locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export async function getTenantOverview(
  db: DbClient,
  tenantId: string,
  options: { includeActivity: boolean },
): Promise<TenantOverview> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({
        currency: tenants.baseCurrency,
        timezone: tenants.defaultTimezone,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const timezone = tenant?.timezone ?? "UTC";

    const [payments] = await tx
      .select({
        attempts: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${storefrontCheckoutPaymentAttempts.status} = 'succeeded')::int`,
        capturedToday: sql<number>`count(*) filter (
          where ${storefrontCheckoutPaymentAttempts.status} = 'succeeded'
            and (${storefrontCheckoutPaymentAttempts.createdAt} at time zone ${timezone})::date
              = (now() at time zone ${timezone})::date
        )::int`,
        revenueMinorToday: sql<number>`coalesce(sum(${storefrontCheckoutPaymentAttempts.amountMinor}) filter (
          where ${storefrontCheckoutPaymentAttempts.status} = 'succeeded'
            and (${storefrontCheckoutPaymentAttempts.createdAt} at time zone ${timezone})::date
              = (now() at time zone ${timezone})::date
        ), 0)::int`,
      })
      .from(storefrontCheckoutPaymentAttempts)
      .where(eq(storefrontCheckoutPaymentAttempts.tenantId, tenantId));

    const [menus] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        live: sql<number>`count(*) filter (where ${catalogueMenus.publishedVersion} is not null)::int`,
      })
      .from(catalogueMenus)
      .where(eq(catalogueMenus.tenantId, tenantId));

    const [locationTotals] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${locations.status} = 'active')::int`,
      })
      .from(locations)
      .where(eq(locations.tenantId, tenantId));

    const [storefrontTotals] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        live: sql<number>`count(*) filter (where ${storefronts.status} = 'active')::int`,
      })
      .from(storefronts)
      .where(eq(storefronts.tenantId, tenantId));

    const [productTotals] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(catalogueProducts)
      .where(eq(catalogueProducts.tenantId, tenantId));

    const activity = options.includeActivity
      ? (await listTenantAuditEventsInTx(tx, tenantId, { limit: 6 })).events
      : [];

    const attempts = payments?.attempts ?? 0;
    const succeeded = payments?.succeeded ?? 0;

    return {
      currency: tenant?.currency ?? "AED",
      timezone,
      payments: {
        capturedToday: payments?.capturedToday ?? 0,
        revenueMinorToday: payments?.revenueMinorToday ?? 0,
        succeeded,
        attempts,
        captureRate: sharePercent(succeeded, attempts),
      },
      menus: { total: menus?.total ?? 0, live: menus?.live ?? 0 },
      locations: {
        total: locationTotals?.total ?? 0,
        active: locationTotals?.active ?? 0,
      },
      storefronts: {
        total: storefrontTotals?.total ?? 0,
        live: storefrontTotals?.live ?? 0,
      },
      products: { total: productTotals?.total ?? 0 },
      activity,
    };
  });
}

export async function listTenantOverviewBranches(
  db: DbClient,
  tenantId: string,
): Promise<TenantOverviewBranch[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    return tx
      .select({
        publicId: locations.publicId,
        name: locations.name,
        timezone: locations.timezone,
        status: locations.status,
      })
      .from(locations)
      .where(eq(locations.tenantId, tenantId))
      .orderBy(locations.name)
      .limit(8);
  });
}
