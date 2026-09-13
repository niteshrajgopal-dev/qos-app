import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  storefrontReleases,
  storefronts,
  tenants,
} from "@/db/schema";
import {
  summarizeStorefrontThemeDraft,
} from "@/lib/audit/tenant-audit";
import { defaultStorefrontThemeDraft } from "@/lib/storefront/default-theme";
import {
  normalizePersistedStorefrontTheme,
  storefrontThemeToRecord,
  StorefrontThemeValidationError,
  validateStorefrontThemeDraftInput,
  type StorefrontThemeDraft,
} from "@/lib/storefront/storefront-theme-schema";
import {
  StorefrontConflictError,
  StorefrontError,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
} from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export type StorefrontThemeDraftView = {
  storefrontPublicId: string;
  draftVersion: number;
  theme: StorefrontThemeDraft;
  tenantDefaultTheme: StorefrontThemeDraft;
  activeReleaseTheme: Record<string, unknown> | null;
};

export type SaveStorefrontThemeDraftInput = {
  expectedVersion: number;
  theme?: unknown;
  resetToDefault?: boolean;
};

async function assertOwnedApprovedLogoDerivative(
  tx: DbClient,
  tenantId: string,
  publicDerivativeId: string,
) {
  const [derivative] = await tx
    .select({
      assetId: catalogueMediaDerivatives.assetId,
    })
    .from(catalogueMediaDerivatives)
    .where(
      and(
        eq(catalogueMediaDerivatives.tenantId, tenantId),
        eq(catalogueMediaDerivatives.publicDerivativeId, publicDerivativeId),
      ),
    )
    .limit(1);

  if (!derivative) {
    throw new StorefrontThemeValidationError(
      "Logo media derivative was not found for this tenant.",
      "theme.logo.publicDerivativeId",
    );
  }

  const [asset] = await tx
    .select({ status: catalogueMediaAssets.status })
    .from(catalogueMediaAssets)
    .where(
      and(
        eq(catalogueMediaAssets.tenantId, tenantId),
        eq(catalogueMediaAssets.id, derivative.assetId),
      ),
    )
    .limit(1);

  if (!asset || asset.status !== "approved") {
    throw new StorefrontThemeValidationError(
      "Logo media must be an approved tenant asset.",
      "theme.logo.publicDerivativeId",
    );
  }
}

async function readTenantDefaultTheme(
  tx: DbClient,
  tenantId: string,
): Promise<StorefrontThemeDraft> {
  const [tenant] = await tx
    .select({ businessProfile: tenants.businessProfile })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new StorefrontError("Tenant not found.", 404);
  }

  return defaultStorefrontThemeDraft(tenant.businessProfile);
}

export async function getStorefrontThemeDraftForStaff(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
): Promise<StorefrontThemeDraftView> {
  await requireActiveStaffMembership(db, tenantId, subject);

  return withTenantContext(db, tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        publicId: storefronts.publicId,
        version: storefronts.version,
        draftConfig: storefronts.draftConfig,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, storefrontPublicId),
        ),
      )
      .limit(1);

    if (!storefront) {
      throw new StorefrontError("Storefront not found.", 404);
    }

    const tenantDefaultTheme = await readTenantDefaultTheme(tx, tenantId);
    const persistedTheme = normalizePersistedStorefrontTheme(
      storefront.draftConfig.theme,
    );
    const theme = persistedTheme ?? tenantDefaultTheme;

    let activeReleaseTheme: Record<string, unknown> | null = null;
    if (storefront.activeReleaseId) {
      const [release] = await tx
        .select({ payload: storefrontReleases.payload })
        .from(storefrontReleases)
        .where(
          and(
            eq(storefrontReleases.tenantId, tenantId),
            eq(storefrontReleases.id, storefront.activeReleaseId),
          ),
        )
        .limit(1);

      activeReleaseTheme = release?.payload.theme ?? null;
    }

    return {
      storefrontPublicId: storefront.publicId,
      draftVersion: storefront.version,
      theme,
      tenantDefaultTheme,
      activeReleaseTheme,
    };
  });
}

export async function saveStorefrontThemeDraftAsAdministrator(
  db: DbClient,
  tenantId: string,
  subject: string,
  storefrontPublicId: string,
  input: SaveStorefrontThemeDraftInput,
) {
  await requireAdministratorMembership(db, tenantId, subject);

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new StorefrontError(
      "expectedVersion must be a positive integer.",
      400,
      "expectedVersion",
    );
  }

  if (input.resetToDefault && input.theme !== undefined) {
    throw new StorefrontError(
      "Provide either theme or resetToDefault, not both.",
      400,
      "resetToDefault",
    );
  }

  if (!input.resetToDefault && input.theme === undefined) {
    throw new StorefrontError("theme is required.", 400, "theme");
  }

  const theme = input.resetToDefault
    ? await withTenantContext(db, tenantId, (tx) =>
        readTenantDefaultTheme(tx, tenantId),
      )
    : validateStorefrontThemeDraftInput(input.theme);

  if (theme.logo?.publicDerivativeId) {
    await withTenantContext(db, tenantId, async (tx) => {
      await assertOwnedApprovedLogoDerivative(
        tx,
        tenantId,
        theme.logo!.publicDerivativeId,
      );
    });
  }

  const [current] = await withTenantContext(db, tenantId, async (tx) => {
    const [storefront] = await tx
      .select({
        version: storefronts.version,
        draftConfig: storefronts.draftConfig,
      })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.tenantId, tenantId),
          eq(storefronts.publicId, storefrontPublicId),
        ),
      )
      .limit(1);

    return [storefront];
  });

  if (!current) {
    throw new StorefrontError("Storefront not found.", 404);
  }

  const updated = await updateStorefrontDraft(db, tenantId, storefrontPublicId, {
    expectedVersion: input.expectedVersion,
    draftConfig: {
      ...current.draftConfig,
      theme: storefrontThemeToRecord(theme),
    },
    audit: {
      actorSubject: subject,
      actorClass: "staff_administrator",
      action: input.resetToDefault
        ? "storefront.theme_draft.reset"
        : "storefront.theme_draft.save",
      beforeSummary: summarizeStorefrontThemeDraft(
        current.draftConfig.theme ?? null,
      ),
      afterSummary: summarizeStorefrontThemeDraft(storefrontThemeToRecord(theme)),
    },
  });

  return {
    storefrontPublicId,
    draftVersion: updated.version,
    theme,
    resetToDefault: Boolean(input.resetToDefault),
    savedBySubject: subject,
  };
}

export { StorefrontThemeValidationError, StorefrontConflictError };
