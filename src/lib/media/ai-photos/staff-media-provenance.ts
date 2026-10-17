import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { catalogueMediaAssets, catalogueProducts } from "@/db/schema";
import { metadataOf } from "@/lib/media/ai-photos/ai-photo-candidates";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export type StaffMediaGenerationView = Record<string, unknown> & { prompt?: string };

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

    const includePrompt = membership.role === "administrator";
    return {
      assetPublicId: asset.publicId,
      sourceProvenance: asset.sourceProvenance,
      generation: toStaffGenerationView(metadataOf(asset), includePrompt),
    };
  });
}
