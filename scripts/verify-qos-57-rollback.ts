/**
 * QOS-57 validation — publish/rollback without redeploying the storefront renderer.
 *
 *   npm run verify:qos-57
 */

import { eq } from "drizzle-orm";
import { execSync } from "node:child_process";

import { createDbClient } from "@/db/client";
import { storefrontDomains, storefronts, tenants } from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";
import {
  publishStorefrontReleaseAsAdministrator,
  rollbackStorefrontReleaseAsAdministrator,
} from "@/lib/storefront/storefront-publish";
import {
  listStorefrontReleases,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import type { StorefrontDraftConfig } from "@/db/schema";

const API_BASE =
  process.env.QOS_API_BASE_URL ??
  "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io";

const TENANTS = [
  {
    label: "Quotes",
    hostname: "quotes.dev.qosapp.com",
    adminSubject: "seed.quotes-multi-branch@qosapp.com",
  },
  {
    label: "Flowers",
    hostname: "flowers.dev.qosapp.com",
    adminSubject: "seed.flowers-storefront@qosapp.com",
  },
] as const;

type ManifestSnapshot = {
  releasePublicId: string;
  releaseVersion: number;
  locationCount: number;
  branchNames: string[];
};

const failures: string[] = [];

function check(condition: boolean, message: string) {
  if (!condition) {
    failures.push(message);
  }
}

async function fetchManifest(hostname: string): Promise<ManifestSnapshot | null> {
  const url = new URL("/api/public/storefronts/manifest", `${API_BASE}/`);
  url.searchParams.set("host", hostname);
  url.searchParams.set("contractVersion", "1");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    manifest?: {
      releasePublicId: string;
      releaseVersion: number;
      locations?: Array<{ name: string }>;
    };
  };

  const manifest = payload.manifest;
  if (!manifest) {
    return null;
  }

  return {
    releasePublicId: manifest.releasePublicId,
    releaseVersion: manifest.releaseVersion,
    locationCount: manifest.locations?.length ?? 0,
    branchNames: manifest.locations?.map((location) => location.name) ?? [],
  };
}

function readStorefrontImageTag() {
  try {
    const raw = execSync(
      "az containerapp show --name ca-qos-dev-storefront --resource-group rg-qos-dev-core --query properties.template.containers[0].image -o tsv",
      { encoding: "utf8" },
    );
    return raw.trim();
  } catch {
    return process.env.QOS_STOREFRONT_IMAGE ?? "unknown";
  }
}

async function resolveStorefront(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  hostname: string,
) {
  const [domain] = await db
    .select({
      tenantId: storefrontDomains.tenantId,
      storefrontId: storefrontDomains.storefrontId,
      hostname: storefrontDomains.hostname,
    })
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, hostname))
    .limit(1);

  if (!domain) {
    throw new Error(`No storefront domain registered for ${hostname}.`);
  }

  return withTenantContext(db, domain.tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        publicId: storefronts.publicId,
        version: storefronts.version,
        draftConfig: storefronts.draftConfig,
      })
      .from(storefronts)
      .where(eq(storefronts.id, domain.storefrontId))
      .limit(1);

    const [tenant] = await tx
      .select({ publicId: tenants.publicId })
      .from(tenants)
      .where(eq(tenants.id, domain.tenantId))
      .limit(1);

    if (!storefront || !tenant) {
      throw new Error(`Storefront context missing for ${hostname}.`);
    }

    return {
      tenantId: domain.tenantId,
      tenantPublicId: tenant.publicId,
      storefrontPublicId: storefront.publicId,
      draftVersion: storefront.version,
      draftConfig: storefront.draftConfig,
    };
  });
}

async function ensureSecondRelease(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  tenantId: string,
  storefrontPublicId: string,
  adminSubject: string,
  draftVersion: number,
  draftConfig: StorefrontDraftConfig,
) {
  const theme = draftConfig.theme ?? {};
  const colors =
    theme.colors && typeof theme.colors === "object"
      ? theme.colors
      : {};
  const accent =
    "accent" in colors && typeof colors.accent === "string"
      ? colors.accent
      : "#ec4899";
  const nextAccent = accent === "#ec4899" ? "#db2777" : "#ec4899";

  await updateStorefrontDraft(db, tenantId, storefrontPublicId, {
    expectedVersion: draftVersion,
    draftConfig: {
      ...draftConfig,
      theme: {
        ...theme,
        colors: {
          ...colors,
          accent: nextAccent,
        },
      },
    },
  });

  await publishStorefrontReleaseAsAdministrator(
    db,
    tenantId,
    adminSubject,
    storefrontPublicId,
  );
}

async function verifyTenantRollback(
  db: Awaited<ReturnType<typeof createDbClient>>["db"],
  input: (typeof TENANTS)[number],
  imageBefore: string,
) {
  console.log(`\n${input.label} rollback`);

  const storefront = await resolveStorefront(db, input.hostname);
  let releases = await listStorefrontReleases(
    db,
    storefront.tenantId,
    storefront.storefrontPublicId,
  );

  if (releases.length < 2) {
    console.log(`  · only ${releases.length} release — publishing a second release for rollback test`);
    await ensureSecondRelease(
      db,
      storefront.tenantId,
      storefront.storefrontPublicId,
      input.adminSubject,
      storefront.draftVersion,
      storefront.draftConfig,
    );
    releases = await listStorefrontReleases(
      db,
      storefront.tenantId,
      storefront.storefrontPublicId,
    );
  }

  check(releases.length >= 2, `${input.label} expected at least two releases`);

  const sorted = [...releases].sort(
    (left, right) => right.releaseVersion - left.releaseVersion,
  );
  const active = sorted.find((release) => release.isActive);
  const prior = sorted.find(
    (release) =>
      !release.isActive &&
      active &&
      release.releaseVersion < active.releaseVersion,
  );

  if (!active || !prior) {
    failures.push(`${input.label} could not resolve active and prior releases`);
    return;
  }

  const before = await fetchManifest(input.hostname);
  check(Boolean(before), `${input.label} manifest unavailable before rollback`);
  if (!before) {
    return;
  }

  check(
    before.releasePublicId === active.publicId,
    `${input.label} manifest should match active release before rollback`,
  );

  const rollback = await rollbackStorefrontReleaseAsAdministrator(
    db,
    storefront.tenantId,
    input.adminSubject,
    storefront.storefrontPublicId,
    prior.publicId,
  );

  check(
    rollback.releaseVersion === prior.releaseVersion,
    `${input.label} rollback did not activate prior release`,
  );

  const afterRollback = await fetchManifest(input.hostname);
  check(Boolean(afterRollback), `${input.label} manifest unavailable after rollback`);
  if (afterRollback) {
    check(
      afterRollback.releasePublicId === prior.publicId,
      `${input.label} manifest release id did not change on rollback`,
    );
    check(
      afterRollback.releaseVersion === prior.releaseVersion,
      `${input.label} manifest release version did not change on rollback`,
    );
    if (before.locationCount !== afterRollback.locationCount) {
      console.log(
        `  · location count ${before.locationCount} → ${afterRollback.locationCount}`,
      );
    }
  }

  const imageDuring = readStorefrontImageTag();
  check(
    imageDuring === imageBefore,
    `${input.label} storefront container image changed during rollback`,
  );

  const restore = await rollbackStorefrontReleaseAsAdministrator(
    db,
    storefront.tenantId,
    input.adminSubject,
    storefront.storefrontPublicId,
    active.publicId,
  );

  check(
    restore.releaseVersion === active.releaseVersion,
    `${input.label} restore did not reactivate original release`,
  );

  const afterRestore = await fetchManifest(input.hostname);
  if (afterRestore) {
    check(
      afterRestore.releasePublicId === active.publicId,
      `${input.label} manifest did not restore to original active release`,
    );
    console.log(
      `  · rollback v${prior.releaseVersion} → restore v${active.releaseVersion} on ${input.hostname}`,
    );
    console.log(
      `  · manifest locations: ${afterRestore.branchNames.join(", ") || "(none)"}`,
    );
  }
}

async function main() {
  console.log("QOS-57 rollback validation");

  const imageBefore = readStorefrontImageTag();
  console.log(`  · storefront image before: ${imageBefore}`);

  const { db, sql } = createDbClient();

  try {
    for (const tenant of TENANTS) {
      await verifyTenantRollback(db, tenant, imageBefore);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  const imageAfter = readStorefrontImageTag();
  check(
    imageAfter === imageBefore,
    `storefront container image changed during validation (${imageBefore} → ${imageAfter})`,
  );
  console.log(`  · storefront image after: ${imageAfter}`);

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nAll QOS-57 rollback checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
