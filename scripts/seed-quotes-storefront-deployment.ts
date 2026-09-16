/**
 * Idempotent seed for the dedicated Quotes StorefrontDeployment record.
 *
 *   npx tsx scripts/seed-quotes-storefront-deployment.ts
 */

import { and, eq, sql } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import { storefrontDeployments, storefronts } from "@/db/schema";
import { QUOTES_TENANT_PUBLIC_ID } from "@/lib/seed/constants";
import { upsertStorefrontDeployment } from "@/lib/storefront/storefront-deployments";
import { withTenantContext } from "@/lib/tenant/context";

const STOREFRONT_PUBLIC_ID = "stf_quotes_e748d7fc";
const DEPLOYMENT_PUBLIC_ID = "sfd_quotes_dev_uaenorth";
const CONTAINER_APP_NAME = "ca-qos-dev-storefront-quotes";
const APPLICATION_VERSION = "0.12.0";

const EXPECTED = {
  storefrontPublicId: STOREFRONT_PUBLIC_ID,
  environment: "dev",
  region: "uaenorth",
  containerAppName: CONTAINER_APP_NAME,
  lifecycleStatus: "active" as const,
  applicationVersion: APPLICATION_VERSION,
  imageRepository: "qos-storefront",
  publicId: DEPLOYMENT_PUBLIC_ID,
};

async function resolveQuotesTenantId(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
) {
  const rows = await db.execute<{ id: string | null }>(
    sql`select qos.resolve_tenant_id_by_public_id(${QUOTES_TENANT_PUBLIC_ID}) as id`,
  );
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row?.id ?? null;
}

async function main() {
  const { db, sql: sqlClient } = createDbClient();

  try {
    const tenantId = await resolveQuotesTenantId(db);
    if (!tenantId) {
      throw new Error(
        `Tenant ${QUOTES_TENANT_PUBLIC_ID} was not found. Run demo seed first.`,
      );
    }

    const [storefront] = await db
      .select({ publicId: storefronts.publicId })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, STOREFRONT_PUBLIC_ID),
        ),
      )
      .limit(1);

    if (!storefront) {
      throw new Error(
        `Storefront ${STOREFRONT_PUBLIC_ID} was not found for ${QUOTES_TENANT_PUBLIC_ID}.`,
      );
    }

    const deployment = await upsertStorefrontDeployment(db, tenantId, EXPECTED);

    const verified = await withTenantContext(db, tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(storefrontDeployments)
        .where(eq(storefrontDeployments.publicId, deployment.publicId))
        .limit(1);

      return row;
    });

    if (
      !verified ||
      verified.containerAppName !== EXPECTED.containerAppName ||
      verified.applicationVersion !== EXPECTED.applicationVersion ||
      verified.lifecycleStatus !== EXPECTED.lifecycleStatus
    ) {
      throw new Error("Quotes StorefrontDeployment verification failed.");
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          deployment: {
            publicId: verified.publicId,
            storefrontPublicId: STOREFRONT_PUBLIC_ID,
            tenantPublicId: QUOTES_TENANT_PUBLIC_ID,
            environment: verified.environment,
            region: verified.region,
            containerAppName: verified.containerAppName,
            lifecycleStatus: verified.lifecycleStatus,
            applicationVersion: verified.applicationVersion,
            imageRepository: verified.imageRepository,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
