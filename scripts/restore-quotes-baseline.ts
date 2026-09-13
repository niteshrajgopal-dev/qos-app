import { eq } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import { storefrontDomains, storefronts } from "@/db/schema";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import { publishStorefrontReleaseAsAdministrator } from "@/lib/storefront/storefront-publish";
import { updateStorefrontDraft } from "@/lib/storefront/storefronts";
import { withTenantContext } from "@/lib/tenant/context";

const ADMIN = "seed.quotes-multi-branch@qosapp.com";
const HOST = "quotes.dev.qosapp.com";

async function main() {
  const { db, sql } = createDbClient();

  try {
    const [domain] = await db
      .select()
      .from(storefrontDomains)
      .where(eq(storefrontDomains.hostname, HOST))
      .limit(1);

    if (!domain) {
      throw new Error(`No domain for ${HOST}`);
    }

    const storefront = await withTenantContext(db, domain.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(storefronts)
        .where(eq(storefronts.id, domain.storefrontId))
        .limit(1);
      return row;
    });

    if (!storefront) {
      throw new Error("Storefront missing.");
    }

    await updateStorefrontDraft(db, domain.tenantId, storefront.publicId, {
      expectedVersion: storefront.version,
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
    });

    const refreshed = await withTenantContext(db, domain.tenantId, async (tx) => {
      const [row] = await tx
        .select({ version: storefronts.version })
        .from(storefronts)
        .where(eq(storefronts.id, domain.storefrontId))
        .limit(1);
      return row;
    });

    const result = await publishStorefrontReleaseAsAdministrator(
      db,
      domain.tenantId,
      ADMIN,
      storefront.publicId,
    );

    console.log(
      `Restored ${HOST}: release v${result.releaseVersion} (${result.releasePublicId}), draft v${refreshed?.version}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
