import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { catalogueMediaAssets, catalogueProducts } from "@/db/schema";
import { metadataOf } from "@/lib/media/ai-photos/ai-photo-candidates";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { resolveStaffDisplayNamesInTenant } from "@/lib/staff/subject-display";
import { withTenantContext } from "@/lib/tenant/context";

export type StaffMediaGenerationView = Record<string, unknown> & {
  prompt?: string;
  /** Tenant-scoped staff label; never a raw provider subject. */
  requestedByDisplayName?: string;
  reviewedByDisplayName?: string;
};

export type StaffMediaProvenanceView = {
  assetPublicId: string;
  sourceProvenance: (typeof catalogueMediaAssets.$inferSelect)["sourceProvenance"];
  /** Present for ai_generated assets; never includes private prompts for non-administrators. */
  generation: StaffMediaGenerationView;
};

export function toStaffGenerationView(
  metadata: Record<string, unknown>,
  includePrompt: boolean,
): StaffMediaGenerationView {
  const { prompt, ...rest } = metadata;
  return includePrompt && typeof prompt === "string" ? { ...rest, prompt } : rest;
}

export function toStaffGenerationViewForTenant(
  metadata: Record<string, unknown>,
  includePrompt: boolean,
  displayNames: ReadonlyMap<string, string>,
): StaffMediaGenerationView {
  const view = toStaffGenerationView(metadata, includePrompt);
  const requestedBySubject =
    typeof metadata.requestedBySubject === "string" ? metadata.requestedBySubject : null;
  if (requestedBySubject) {
    const resolved = displayNames.get(requestedBySubject);
    if (resolved) {
      view.requestedByDisplayName = resolved;
    }
  }
  const review = metadata.review;
  if (review && typeof review === "object" && review !== null) {
    const decidedBySubject =
      "decidedBySubject" in review && typeof review.decidedBySubject === "string"
        ? review.decidedBySubject
        : null;
    if (decidedBySubject) {
      const resolved = displayNames.get(decidedBySubject);
      if (resolved) {
        view.reviewedByDisplayName = resolved;
      }
    }
  }
  return view;
}

/**
 * Primary media provenance for catalogue staff. Prompt text is administrator-only;
 * other authorized staff still see model, review and context fingerprints.
 */
export async function getStaffProductPrimaryMediaProvenance(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<StaffMediaProvenanceView | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [product] = await tx
      .select({ id: catalogueProducts.id, primaryMediaAssetId: catalogueProducts.primaryMediaAssetId })
      .from(catalogueProducts)
      .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, productPublicId)))
      .limit(1);
    if (!product?.primaryMediaAssetId) {
      return null;
    }

    const [asset] = await tx
      .select()
      .from(catalogueMediaAssets)
      .where(
        and(eq(catalogueMediaAssets.tenantId, tenantId), eq(catalogueMediaAssets.id, product.primaryMediaAssetId)),
      )
      .limit(1);
    if (!asset || asset.status !== "approved") {
      return null;
    }

    const metadata = metadataOf(asset);
    const subjects = [
      typeof metadata.requestedBySubject === "string" ? metadata.requestedBySubject : null,
      metadata.review &&
      typeof metadata.review === "object" &&
      "decidedBySubject" in metadata.review &&
      typeof metadata.review.decidedBySubject === "string"
        ? metadata.review.decidedBySubject
        : null,
    ].filter((subject): subject is string => Boolean(subject));
    const displayNames = await resolveStaffDisplayNamesInTenant(tx, tenantId, subjects);
    const includePrompt = membership.role === "administrator";
    return {
      assetPublicId: asset.publicId,
      sourceProvenance: asset.sourceProvenance,
      generation: toStaffGenerationViewForTenant(metadata, includePrompt, displayNames),
    };
  });
}
