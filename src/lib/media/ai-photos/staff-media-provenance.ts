import { and, desc, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { catalogueMediaAssets, catalogueProducts, tenantAuditEvents } from "@/db/schema";
import { metadataOf } from "@/lib/media/ai-photos/ai-photo-candidates";
import { StaffAuthorizationError, type ActiveStaffMembership } from "@/lib/staff/auth";
import { resolveStaffDisplayNamesInTenant } from "@/lib/staff/subject-display";
import { withTenantContext } from "@/lib/tenant/context";

const PRIMARY_PHOTO_REMOVED_ACTION = "catalogue.media.primary_photo_removed";

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

export type StaffRemovedPrimaryPhotoView = {
  assetPublicId: string;
  removedAt: string;
  removedByDisplayName?: string;
  sourceProvenance: (typeof catalogueMediaAssets.$inferSelect)["sourceProvenance"];
  generation: StaffMediaGenerationView;
};

function previousAssetPublicIdFromAudit(changeSummary: unknown): string | null {
  if (!changeSummary || typeof changeSummary !== "object") {
    return null;
  }
  const value = (changeSummary as { previousAssetPublicId?: unknown }).previousAssetPublicId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

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

/**
 * Administrator-only history of primary photos removed from the draft product.
 * Built from tenant audit events; never included in public menu payloads.
 */
export async function getStaffProductRemovedPrimaryPhotoHistory(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<StaffRemovedPrimaryPhotoView[]> {
  if (membership.role !== "administrator") {
    throw new StaffAuthorizationError("Only administrators can view removed photo history.");
  }

  return withTenantContext(db, tenantId, async (tx) => {
    const audits = await tx
      .select({
        actorSubject: tenantAuditEvents.actorSubject,
        changeSummary: tenantAuditEvents.changeSummary,
        occurredAt: tenantAuditEvents.occurredAt,
      })
      .from(tenantAuditEvents)
      .where(
        and(
          eq(tenantAuditEvents.tenantId, tenantId),
          eq(tenantAuditEvents.entityType, "catalogue_product"),
          eq(tenantAuditEvents.entityPublicId, productPublicId),
          eq(tenantAuditEvents.action, PRIMARY_PHOTO_REMOVED_ACTION),
        ),
      )
      .orderBy(desc(tenantAuditEvents.occurredAt));

    const assetPublicIds = audits
      .map((row) => previousAssetPublicIdFromAudit(row.changeSummary))
      .filter((id): id is string => Boolean(id));
    if (assetPublicIds.length === 0) {
      return [];
    }

    const assets = await tx
      .select()
      .from(catalogueMediaAssets)
      .where(
        and(
          eq(catalogueMediaAssets.tenantId, tenantId),
          inArray(catalogueMediaAssets.publicId, assetPublicIds),
        ),
      );
    const assetByPublicId = new Map(assets.map((asset) => [asset.publicId, asset]));

    const subjects = new Set<string>();
    for (const audit of audits) {
      subjects.add(audit.actorSubject);
    }
    for (const asset of assets) {
      const metadata = metadataOf(asset);
      if (typeof metadata.requestedBySubject === "string") {
        subjects.add(metadata.requestedBySubject);
      }
      const review = metadata.review;
      if (
        review &&
        typeof review === "object" &&
        "decidedBySubject" in review &&
        typeof review.decidedBySubject === "string"
      ) {
        subjects.add(review.decidedBySubject);
      }
    }
    const displayNames = await resolveStaffDisplayNamesInTenant(tx, tenantId, [...subjects]);

    const history: StaffRemovedPrimaryPhotoView[] = [];
    for (const audit of audits) {
      const assetPublicId = previousAssetPublicIdFromAudit(audit.changeSummary);
      if (!assetPublicId) {
        continue;
      }
      const asset = assetByPublicId.get(assetPublicId);
      if (!asset) {
        continue;
      }
      const metadata = metadataOf(asset);
      const removedByDisplayName = displayNames.get(audit.actorSubject);
      history.push({
        assetPublicId,
        removedAt: audit.occurredAt.toISOString(),
        ...(removedByDisplayName ? { removedByDisplayName } : {}),
        sourceProvenance: asset.sourceProvenance,
        generation: toStaffGenerationViewForTenant(metadata, true, displayNames),
      });
    }
    return history;
  });
}
