/**
 * QOS-47 / QOS-48 verification — theme + content block drafts, manifest, renderer.
 *
 *   npm run verify:qos-47-48
 */

import { eq } from "drizzle-orm";

import { createDbClient } from "@/db/client";
import { storefrontDomains, storefronts, tenants } from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";
import {
  publishStorefrontReleaseAsAdministrator,
  rollbackStorefrontReleaseAsAdministrator,
} from "@/lib/storefront/storefront-publish";
import { saveStorefrontContentBlocksDraftAsAdministrator } from "@/lib/storefront/storefront-content-blocks-draft";
import { saveStorefrontThemeDraftAsAdministrator } from "@/lib/storefront/storefront-theme-draft";
import {
  listStorefrontReleases,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import type { StorefrontDraftConfig } from "@/db/schema";

const API_BASE =
  process.env.QOS_API_BASE_URL ??
  "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io";

const QUOTES_HOST = "quotes.dev.qosapp.com";
const ADMIN_SUBJECT = "seed.quotes-multi-branch@qosapp.com";
const VERIFY_PRIMARY = "#1B3A4B";
const VERIFY_ACCENT = "#CBB792";
const VERIFY_HERO_EN = "VERIFY QOS-47 EN hero";
const VERIFY_HERO_AR = "تحقق QOS-47 AR بطل";

const failures: string[] = [];

function check(condition: boolean, message: string) {
  if (!condition) {
    failures.push(message);
  }
}

type ManifestPayload = {
  releasePublicId: string;
  releaseVersion: number;
  theme: Record<string, unknown>;
  contentBlocks: Array<{
    id: string;
    type: string;
    visible?: boolean;
    props: Record<string, unknown>;
  }>;
};

async function fetchManifest(hostname: string): Promise<ManifestPayload | null> {
  const url = new URL("/api/public/storefronts/manifest", `${API_BASE}/`);
  url.searchParams.set("host", hostname);
  url.searchParams.set("contractVersion", "1");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { manifest?: ManifestPayload };
  return payload.manifest ?? null;
}

async function resolveQuotesStorefront(db: Awaited<ReturnType<typeof createDbClient>>["db"]) {
  const [domain] = await db
    .select({
      tenantId: storefrontDomains.tenantId,
      storefrontId: storefrontDomains.storefrontId,
    })
    .from(storefrontDomains)
    .where(eq(storefrontDomains.hostname, QUOTES_HOST))
    .limit(1);

  if (!domain) {
    throw new Error(`No storefront domain registered for ${QUOTES_HOST}.`);
  }

  return withTenantContext(db, domain.tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        publicId: storefronts.publicId,
        version: storefronts.version,
        draftConfig: storefronts.draftConfig,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefronts)
      .where(eq(storefronts.id, domain.storefrontId))
      .limit(1);

    if (!storefront) {
      throw new Error("Quotes storefront missing.");
    }

    return {
      tenantId: domain.tenantId,
      storefrontPublicId: storefront.publicId,
      draftVersion: storefront.version,
      draftConfig: storefront.draftConfig,
      activeReleaseId: storefront.activeReleaseId,
    };
  });
}

function readHeroCopy(manifest: ManifestPayload, field: "title" | "subtitle") {
  const hero = manifest.contentBlocks.find((block) => block.type === "hero");
  const value = hero?.props[field];
  if (typeof value === "object" && value !== null) {
    return value as { en?: string; ar?: string };
  }
  return null;
}

async function main() {
  const { db, sql } = createDbClient();

  try {
    console.log("QOS-47 / QOS-48 verification\n");

    const storefront = await resolveQuotesStorefront(db);
    const releasesBefore = await listStorefrontReleases(
      db,
      storefront.tenantId,
      storefront.storefrontPublicId,
    );
    const activeBefore = releasesBefore.find((release) => release.isActive);
    check(Boolean(activeBefore), "Quotes active release exists before test");

    const manifestBefore = await fetchManifest(QUOTES_HOST);
    check(Boolean(manifestBefore), "Quotes manifest available before test");
    if (!manifestBefore || !activeBefore) {
      throw new Error("Baseline manifest unavailable.");
    }

    const baselineDraftConfig = structuredClone(storefront.draftConfig);
    const baselineDraftVersion = storefront.draftVersion;
    const baselineReleasePublicId = manifestBefore.releasePublicId;

    const theme = baselineDraftConfig.theme ?? {};
    const colors =
      theme.colors && typeof theme.colors === "object"
        ? (theme.colors as Record<string, string>)
        : {};

    await saveStorefrontThemeDraftAsAdministrator(
      db,
      storefront.tenantId,
      ADMIN_SUBJECT,
      storefront.storefrontPublicId,
      {
        expectedVersion: baselineDraftVersion,
        theme: {
          schemaVersion: 1,
          preset:
            typeof theme.preset === "string"
              ? theme.preset
              : "hospitality_baseline",
          colors: {
            primary: VERIFY_PRIMARY,
            accent: VERIFY_ACCENT,
            background:
              typeof colors.background === "string" ? colors.background : "#F5F1E9",
            text: typeof colors.text === "string" ? colors.text : "#2F2322",
          },
          typography: {
            body: "inter",
            display: "young-serif",
          },
        },
      },
    );

    const afterThemeSave = await fetchManifest(QUOTES_HOST);
    check(Boolean(afterThemeSave), "Manifest available after theme draft save");
    if (afterThemeSave) {
      check(
        afterThemeSave.releasePublicId === baselineReleasePublicId,
        "Live release unchanged after theme draft save",
      );
      check(
        JSON.stringify(afterThemeSave.theme) === JSON.stringify(manifestBefore.theme),
        "Live manifest theme must not change until publish",
      );
    }

    const refreshed = await resolveQuotesStorefront(db);
    const heroBlock =
      refreshed.draftConfig.contentBlocks?.find((block) => block.type === "hero") ??
      refreshed.draftConfig.contentBlocks?.[0];

    const contentBlocks = (refreshed.draftConfig.contentBlocks ?? []).map((block) => {
      if (block.id === heroBlock?.id || block.type === "hero") {
        return {
          id: block.id,
          type: "hero",
          schemaVersion: 1,
          visible: true,
          props: {
            title: { en: VERIFY_HERO_EN, ar: VERIFY_HERO_AR },
            subtitle: {
              en: "Verified bilingual subtitle EN.",
              ar: "ترجمة فرعية ثنائية اللغة.",
            },
          },
        };
      }

      return {
        id: block.id,
        type: block.type,
        schemaVersion: block.schemaVersion ?? 1,
        visible: block.visible ?? true,
        props: block.props,
      };
    });

    if (contentBlocks.length === 0) {
      contentBlocks.push({
        id: "hero",
        type: "hero",
        schemaVersion: 1,
        visible: true,
        props: {
          title: { en: VERIFY_HERO_EN, ar: VERIFY_HERO_AR },
          subtitle: {
            en: "Verified bilingual subtitle EN.",
            ar: "ترجمة فرعية ثنائية اللغة.",
          },
        },
      });
    }

    await saveStorefrontContentBlocksDraftAsAdministrator(
      db,
      storefront.tenantId,
      ADMIN_SUBJECT,
      storefront.storefrontPublicId,
      {
        expectedVersion: refreshed.draftVersion,
        contentBlocks,
      },
    );

    const afterBlocksSave = await fetchManifest(QUOTES_HOST);
    if (afterBlocksSave) {
      check(
        afterBlocksSave.releasePublicId === baselineReleasePublicId,
        "Live release unchanged after content block draft save",
      );
    }

    await publishStorefrontReleaseAsAdministrator(
      db,
      storefront.tenantId,
      ADMIN_SUBJECT,
      storefront.storefrontPublicId,
    );

    const manifestPublished = await fetchManifest(QUOTES_HOST);
    check(Boolean(manifestPublished), "Manifest available after publish");
    if (manifestPublished) {
      check(
        manifestPublished.releasePublicId !== baselineReleasePublicId,
        "Publish created a new active release",
      );

      const publishedPrimary =
        manifestPublished.theme.colors &&
        typeof manifestPublished.theme.colors === "object" &&
        "primary" in manifestPublished.theme.colors
          ? String(
              (manifestPublished.theme.colors as Record<string, unknown>).primary,
            ).toUpperCase()
          : "";
      check(
        publishedPrimary === VERIFY_PRIMARY,
        `Published manifest primary colour expected ${VERIFY_PRIMARY}, got ${publishedPrimary}`,
      );

      const heroTitle = readHeroCopy(manifestPublished, "title");
      check(heroTitle?.en === VERIFY_HERO_EN, "Published hero title EN mismatch");
      check(heroTitle?.ar === VERIFY_HERO_AR, "Published hero title AR mismatch");
    }

    console.log("  · draft save kept live release unchanged");
    console.log("  · publish updated manifest theme + bilingual hero");

    const localRendererUrl = process.env.QOS_VERIFY_RENDERER_URL ?? "http://127.0.0.1:3100";
    try {
      const homeEn = await fetch(localRendererUrl);
      const homeEnText = await homeEn.text();
      check(homeEn.ok, `Local renderer EN home expected 200, got ${homeEn.status}`);
      check(
        homeEnText.includes(VERIFY_HERO_EN),
        "Local renderer EN home missing verified hero copy",
      );

      const homeAr = await fetch(localRendererUrl, {
        headers: {
          Cookie: "quotes.locale=ar",
        },
      });
      const homeArText = await homeAr.text();
      check(homeAr.ok, `Local renderer AR home expected 200, got ${homeAr.status}`);
      check(
        homeArText.includes(VERIFY_HERO_AR),
        "Local renderer AR home missing verified hero copy",
      );

      console.log("  · local renderer shows EN/AR hero from manifest");
    } catch (error) {
      failures.push(
        `Local renderer check skipped or failed (${localRendererUrl}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await updateStorefrontDraft(db, storefront.tenantId, storefront.storefrontPublicId, {
      expectedVersion: (await resolveQuotesStorefront(db)).draftVersion,
      draftConfig: baselineDraftConfig as StorefrontDraftConfig,
    });

    await rollbackStorefrontReleaseAsAdministrator(
      db,
      storefront.tenantId,
      ADMIN_SUBJECT,
      storefront.storefrontPublicId,
      baselineReleasePublicId,
    );

    const manifestRestored = await fetchManifest(QUOTES_HOST);
    if (manifestRestored) {
      check(
        manifestRestored.releasePublicId === baselineReleasePublicId,
        "Dev storefront restored to baseline release",
      );
    }

    console.log("  · dev storefront restored to baseline release");

    if (failures.length > 0) {
      console.error("\nFailures:");
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      process.exit(1);
    }

    console.log("\nAll QOS-47 / QOS-48 checks passed.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
