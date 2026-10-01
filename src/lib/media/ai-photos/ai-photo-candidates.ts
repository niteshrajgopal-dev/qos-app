import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import sharp from "sharp";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaUploadGrants,
  catalogueProducts,
  catalogueProductTranslations,
} from "@/db/schema";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { assertMenuLocationAccess, loadDraftMenuEditorView, MenuError } from "@/lib/catalogue/menus";
import {
  aiPhotoUnavailableReason,
  readAiPhotoConfig,
  type AiPhotoConfig,
  type AiPhotoUnavailableReason,
} from "@/lib/media/ai-photos/config";
import {
  AI_PHOTO_PROMPT_VERSION,
  aiPhotoContextSha256,
  buildAiPhotoPrompt,
  type AiPhotoProductContext,
} from "@/lib/media/ai-photos/prompt";
import {
  AiPhotoProviderError,
  type AiPhotoProviderDiagnostics,
  getAiPhotoProvider,
  hasAiPhotoProviderOverride,
  type AiPhotoProvider,
  type AiPhotoUsage,
} from "@/lib/media/ai-photos/provider";
import { readMediaConfig } from "@/lib/media/config";
import {
  createProductImageUploadGrantInTx,
  getApprovedThumbnailPublicIdsForProducts,
  ingestProductImageUpload,
  processProductImageInTx,
} from "@/lib/media/product-images";
import { getMediaStorage } from "@/lib/media/storage";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext, type DbTransaction } from "@/lib/tenant/context";

export const AI_PHOTO_METADATA_SCHEMA = "qos.ai_photo_generation.v1";
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_OUTPUT_DIMENSION = 1536;

export class AiPhotoError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = "AiPhotoError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type AiPhotoCaller = {
  tenantId: string;
  subject: string;
  membership: ActiveStaffMembership;
};

type ServiceOptions = {
  config?: AiPhotoConfig;
  provider?: AiPhotoProvider;
  now?: () => Date;
};

/** Review state as staff see it; derived from the media asset status. */
export type AiPhotoCandidateStatus = "generating" | "pending_review" | "accepted" | "rejected" | "failed";

export type AiPhotoCandidateView = {
  assetPublicId: string;
  productPublicId: string;
  status: AiPhotoCandidateStatus;
  failureCode: string | null;
  createdAt: string;
  previewPath: string | null;
};

export type AiPhotoAvailabilityView = {
  available: boolean;
  unavailableReason: AiPhotoUnavailableReason | null;
  /** Generating spends provider budget, so only administrators may start or accept it. */
  canGenerate: boolean;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
};

export type MenuAiPhotosView = {
  availability: AiPhotoAvailabilityView;
  candidates: AiPhotoCandidateView[];
  /** Products whose current approved photo is an accepted AI image (label it as such). */
  aiPhotoProductPublicIds: string[];
};

type GenerationMetadata = {
  schema: typeof AI_PHOTO_METADATA_SCHEMA;
  provider: string;
  model: string;
  quality: string;
  promptVersion: string;
  prompt: string;
  contextSha256: string;
  menuPublicId: string;
  requestedBySubject: string;
  requestedAt: string;
  completedAt?: string;
  usage?: AiPhotoUsage | null;
  failureCode?: string;
  review?: {
    decision: "accepted" | "rejected";
    decidedBySubject: string;
    decidedAt: string;
    accuracyConfirmed?: boolean;
    replacedAssetPublicId?: string | null;
  };
};

function toStatus(status: (typeof catalogueMediaAssets.$inferSelect)["status"]): AiPhotoCandidateStatus {
  switch (status) {
    case "pending_upload":
    case "processing":
      return "generating";
    case "uploaded":
      return "pending_review";
    case "approved":
      return "accepted";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
  }
}

function metadataOf(asset: { generationMetadata: Record<string, unknown> | null }) {
  return (asset.generationMetadata ?? {}) as Partial<GenerationMetadata>;
}

function candidatePreviewPath(tenantId: string, menuPublicId: string, assetPublicId: string) {
  return `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/ai-photos/${assetPublicId}/preview`;
}

function toCandidateView(
  tenantId: string,
  menuPublicId: string,
  productPublicId: string,
  asset: typeof catalogueMediaAssets.$inferSelect,
): AiPhotoCandidateView {
  const status = toStatus(asset.status);
  return {
    assetPublicId: asset.publicId,
    productPublicId,
    status,
    failureCode: status === "failed" ? (metadataOf(asset).failureCode ?? "generation_failed") : null,
    createdAt: asset.createdAt.toISOString(),
    previewPath:
      status === "pending_review" ? candidatePreviewPath(tenantId, menuPublicId, asset.publicId) : null,
  };
}

function requireAdministrator(caller: AiPhotoCaller) {
  if (caller.membership.role !== "administrator") {
    throw new StaffAuthorizationError("Only administrators can generate or accept AI photos.");
  }
}

function resolveAvailability(config: AiPhotoConfig, options: ServiceOptions) {
  return aiPhotoUnavailableReason(config, {
    providerOverride: Boolean(options.provider) || hasAiPhotoProviderOverride(),
  });
}

type MenuProduct = {
  id: string;
  publicId: string;
  primaryMediaAssetId: string | null;
  context: AiPhotoProductContext;
};

/** Non-archived placements of the menu, with the approved English text used for prompts. */
async function loadMenuProducts(
  tx: DbTransaction,
  tenantId: string,
  menuPublicId: string,
  productPublicIds?: readonly string[],
): Promise<Map<string, MenuProduct>> {
  const menu = await loadDraftMenuEditorView(tx, tenantId, menuPublicId);
  if (!menu) {
    throw new MenuError("Menu not found.", 404);
  }

  const sectionNameByProduct = new Map<string, string>();
  for (const section of menu.sections) {
    if (section.archived) {
      continue;
    }
    for (const placement of section.products) {
      if (placement.archived || sectionNameByProduct.has(placement.productPublicId)) {
        continue;
      }
      sectionNameByProduct.set(
        placement.productPublicId,
        section.translations.en.displayName || section.internalName,
      );
    }
  }

  const wanted = [...sectionNameByProduct.keys()].filter(
    (id) => !productPublicIds || productPublicIds.includes(id),
  );
  const result = new Map<string, MenuProduct>();
  if (wanted.length === 0) {
    return result;
  }

  const rows = await tx
    .select({
      id: catalogueProducts.id,
      publicId: catalogueProducts.publicId,
      internalName: catalogueProducts.internalName,
      status: catalogueProducts.status,
      primaryMediaAssetId: catalogueProducts.primaryMediaAssetId,
      displayName: catalogueProductTranslations.displayName,
      description: catalogueProductTranslations.description,
    })
    .from(catalogueProducts)
    .leftJoin(
      catalogueProductTranslations,
      and(
        eq(catalogueProductTranslations.tenantId, catalogueProducts.tenantId),
        eq(catalogueProductTranslations.productId, catalogueProducts.id),
        eq(catalogueProductTranslations.locale, "en"),
      ),
    )
    .where(
      and(eq(catalogueProducts.tenantId, tenantId), inArray(catalogueProducts.publicId, wanted)),
    );

  for (const row of rows) {
    if (row.status === "archived") {
      continue;
    }
    result.set(row.publicId, {
      id: row.id,
      publicId: row.publicId,
      primaryMediaAssetId: row.primaryMediaAssetId,
      context: {
        displayName: row.displayName?.trim() || row.internalName,
        description: row.description,
        sectionName: sectionNameByProduct.get(row.publicId) ?? null,
      },
    });
  }
  return result;
}

async function requireMenuProduct(
  tx: DbTransaction,
  tenantId: string,
  menuPublicId: string,
  productPublicId: string,
) {
  const product = (await loadMenuProducts(tx, tenantId, menuPublicId, [productPublicId])).get(
    productPublicId,
  );
  if (!product) {
    throw new AiPhotoError("product_not_in_menu", "This item is not on the menu.", 404);
  }
  return product;
}

/**
 * Failures where the provider refused the request before generating anything
 * (bad credentials, rate limit, unreachable, not configured) are not billed,
 * so they do not spend the allowance. Timeouts, unusable output and unknown
 * errors may have been billed and still count.
 */
export const UNBILLED_FAILURE_CODES = [
  "provider_auth",
  "provider_rate_limited",
  "provider_unreachable",
  "provider_unavailable",
] as const;

async function countAttemptsInWindow(tx: DbTransaction, tenantId: string, since: Date) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(catalogueMediaAssets)
    .where(
      and(
        eq(catalogueMediaAssets.tenantId, tenantId),
        eq(catalogueMediaAssets.sourceProvenance, "ai_generated"),
        gte(catalogueMediaAssets.createdAt, since),
        sql`not (${catalogueMediaAssets.status} = 'failed' and coalesce(${catalogueMediaAssets.generationMetadata} ->> 'failureCode', '') in (${sql.join(
          UNBILLED_FAILURE_CODES.map((code) => sql`${code}`),
          sql`, `,
        )}))`,
      ),
    );
  return Number(row?.count ?? 0);
}

async function lockTenantAiPhotos(tx: DbTransaction, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`qos.ai_photos:${tenantId}`}))`);
}

function availabilityView(
  config: AiPhotoConfig,
  reason: AiPhotoUnavailableReason | null,
  caller: AiPhotoCaller,
  usedToday: number,
): AiPhotoAvailabilityView {
  return {
    available: reason === null,
    unavailableReason: reason,
    canGenerate: reason === null && caller.membership.role === "administrator",
    dailyLimit: config.dailyLimitPerTenant,
    usedToday,
    remainingToday: Math.max(0, config.dailyLimitPerTenant - usedToday),
  };
}

export async function getMenuAiPhotos(
  db: DbClient,
  caller: AiPhotoCaller,
  menuPublicId: string,
  options: ServiceOptions = {},
): Promise<MenuAiPhotosView> {
  const config = options.config ?? readAiPhotoConfig();
  const now = options.now?.() ?? new Date();
  const reason = resolveAvailability(config, options);

  return withTenantContext(db, caller.tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, menuPublicId);
    const products = await loadMenuProducts(tx, caller.tenantId, menuPublicId);
    const usedToday = await countAttemptsInWindow(
      tx,
      caller.tenantId,
      new Date(now.getTime() - QUOTA_WINDOW_MS),
    );

    const productList = [...products.values()];
    const publicIdById = new Map(productList.map((product) => [product.id, product.publicId]));
    const assets =
      productList.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueMediaAssets)
            .where(
              and(
                eq(catalogueMediaAssets.tenantId, caller.tenantId),
                eq(catalogueMediaAssets.sourceProvenance, "ai_generated"),
                inArray(
                  catalogueMediaAssets.productId,
                  productList.map((product) => product.id),
                ),
              ),
            )
            .orderBy(desc(catalogueMediaAssets.createdAt));

    const latestByProduct = new Map<string, (typeof assets)[number]>();
    for (const asset of assets) {
      if (!latestByProduct.has(asset.productId)) {
        latestByProduct.set(asset.productId, asset);
      }
    }

    const candidates: AiPhotoCandidateView[] = [];
    for (const asset of latestByProduct.values()) {
      const status = toStatus(asset.status);
      const isRecentFailure =
        status === "failed" && asset.createdAt.getTime() >= now.getTime() - QUOTA_WINDOW_MS;
      if (status === "generating" || status === "pending_review" || isRecentFailure) {
        candidates.push(
          toCandidateView(caller.tenantId, menuPublicId, publicIdById.get(asset.productId)!, asset),
        );
      }
    }

    const approvedAiAssetIds = new Set(
      assets.filter((asset) => asset.status === "approved").map((asset) => asset.id),
    );
    const thumbnails = await getApprovedThumbnailPublicIdsForProducts(tx, caller.tenantId, productList);
    const aiPhotoProductPublicIds = productList
      .filter(
        (product) =>
          product.primaryMediaAssetId !== null &&
          approvedAiAssetIds.has(product.primaryMediaAssetId) &&
          thumbnails.has(product.id),
      )
      .map((product) => product.publicId);

    return {
      availability: availabilityView(config, reason, caller, usedToday),
      candidates,
      aiPhotoProductPublicIds,
    };
  });
}

async function markGenerationFailed(
  db: DbClient,
  caller: AiPhotoCaller,
  assetPublicId: string,
  failureCode: string,
  message: string,
  providerDiagnostics: AiPhotoProviderDiagnostics | null = null,
) {
  return withTenantContext(db, caller.tenantId, async (tx) => {
    const [asset] = await tx
      .select()
      .from(catalogueMediaAssets)
      .where(
        and(
          eq(catalogueMediaAssets.tenantId, caller.tenantId),
          eq(catalogueMediaAssets.publicId, assetPublicId),
        ),
      )
      .limit(1)
      .for("update");
    if (!asset) {
      return null;
    }
    // Only an unfinished reservation can fail; a stored candidate is never downgraded.
    if (asset.status !== "pending_upload") {
      return asset;
    }

    await tx
      .update(catalogueMediaUploadGrants)
      .set({ status: "expired" })
      .where(
        and(
          eq(catalogueMediaUploadGrants.tenantId, caller.tenantId),
          eq(catalogueMediaUploadGrants.assetId, asset.id),
          eq(catalogueMediaUploadGrants.status, "pending"),
        ),
      );

    const [failed] = await tx
      .update(catalogueMediaAssets)
      .set({
        status: "failed",
        failureReason: message,
        generationMetadata: {
          ...metadataOf(asset),
          failureCode,
          ...(providerDiagnostics ? { providerDiagnostics } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(catalogueMediaAssets.id, asset.id))
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.media.ai_photo_failed",
      entityType: "catalogue_media_asset",
      entityPublicId: asset.publicId,
      changeSummary: { failureCode, ...(providerDiagnostics ? { providerDiagnostics } : {}) },
    });
    return failed;
  });
}

/** Re-encodes provider output: rejects anything that is not a decodable image and strips metadata. */
async function normalizeGeneratedImage(bytes: Buffer) {
  const media = readMediaConfig();
  try {
    const output = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: media.maxPixelDimension * media.maxPixelDimension,
    })
      .rotate()
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    if (output.byteLength > media.maxUploadBytes) {
      throw new Error("too large");
    }
    return output;
  } catch {
    throw new AiPhotoProviderError("invalid_output", "The image service returned an unusable image.");
  }
}

export type GenerateAiPhotoResult = {
  candidate: AiPhotoCandidateView;
  /** False when an existing pending candidate was returned instead of spending again. */
  created: boolean;
};

/**
 * Generates one reviewable candidate for a product on the menu. The spend
 * record (an ai_generated asset) is reserved under a per-tenant lock before the
 * provider is called, so the daily limit cannot be overshot by concurrent
 * requests and failures still count. The candidate lands in private
 * quarantine; nothing is attached or public until an administrator accepts it.
 */
export async function generateMenuAiPhoto(
  db: DbClient,
  caller: AiPhotoCaller,
  input: { menuPublicId: string; productPublicId: string },
  options: ServiceOptions = {},
): Promise<GenerateAiPhotoResult> {
  const config = options.config ?? readAiPhotoConfig();
  const now = options.now ?? (() => new Date());
  requireAdministrator(caller);
  const reason = resolveAvailability(config, options);
  if (reason) {
    throw new AiPhotoError("ai_photos_unavailable", "AI photos are not available for this business.", 409);
  }
  const mediaConfig = readMediaConfig();

  const reserved = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, input.menuPublicId);
    await lockTenantAiPhotos(tx, caller.tenantId);
    const product = await requireMenuProduct(tx, caller.tenantId, input.menuPublicId, input.productPublicId);

    const [open] = await tx
      .select()
      .from(catalogueMediaAssets)
      .where(
        and(
          eq(catalogueMediaAssets.tenantId, caller.tenantId),
          eq(catalogueMediaAssets.productId, product.id),
          eq(catalogueMediaAssets.sourceProvenance, "ai_generated"),
          inArray(catalogueMediaAssets.status, ["pending_upload", "uploaded"]),
        ),
      )
      .orderBy(desc(catalogueMediaAssets.createdAt))
      .limit(1);

    if (open?.status === "uploaded") {
      return { kind: "existing" as const, asset: open };
    }
    if (open?.status === "pending_upload") {
      const inFlightUntil = open.createdAt.getTime() + config.requestTimeoutMs + 60_000;
      if (now().getTime() < inFlightUntil) {
        throw new AiPhotoError(
          "generation_in_progress",
          "A photo is already being generated for this item.",
          409,
        );
      }
    }

    const used = await countAttemptsInWindow(
      tx,
      caller.tenantId,
      new Date(now().getTime() - QUOTA_WINDOW_MS),
    );
    if (used >= config.dailyLimitPerTenant) {
      throw new AiPhotoError(
        "daily_limit_reached",
        `This business has used all ${config.dailyLimitPerTenant} AI photo generations for today.`,
        429,
      );
    }

    const prompt = buildAiPhotoPrompt(product.context);
    const metadata: GenerationMetadata = {
      schema: AI_PHOTO_METADATA_SCHEMA,
      provider: config.provider,
      model: config.provider === "mock" ? "mock" : config.model,
      quality: config.quality,
      promptVersion: AI_PHOTO_PROMPT_VERSION,
      prompt,
      contextSha256: aiPhotoContextSha256(product.context),
      menuPublicId: input.menuPublicId,
      requestedBySubject: caller.subject,
      requestedAt: now().toISOString(),
    };

    const grant = await createProductImageUploadGrantInTx(tx, caller.tenantId, product.publicId, {
      expectedByteSize: mediaConfig.maxUploadBytes,
      expectedContentType: "image/jpeg",
      sourceProvenance: "ai_generated",
      generationMetadata: metadata,
      altTextEn: `AI-generated image of ${product.context.displayName}`,
    });

    // An abandoned reservation (worker died mid-call) is closed out honestly.
    if (open?.status === "pending_upload") {
      await tx
        .update(catalogueMediaAssets)
        .set({
          status: "failed",
          failureReason: "Generation did not finish.",
          generationMetadata: { ...metadataOf(open), failureCode: "abandoned" },
          updatedAt: new Date(),
        })
        .where(eq(catalogueMediaAssets.id, open.id));
    }

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.media.ai_photo_requested",
      entityType: "catalogue_media_asset",
      entityPublicId: grant.assetPublicId,
      changeSummary: {
        productPublicId: product.publicId,
        menuPublicId: input.menuPublicId,
        model: config.model,
        quality: config.quality,
        usedToday: used + 1,
        dailyLimit: config.dailyLimitPerTenant,
      },
    });

    return { kind: "reserved" as const, grant, prompt, productPublicId: product.publicId };
  });

  if (reserved.kind === "existing") {
    return {
      candidate: toCandidateView(caller.tenantId, input.menuPublicId, input.productPublicId, reserved.asset),
      created: false,
    };
  }

  const { grant } = reserved;
  let bytes: Buffer;
  let usage: AiPhotoUsage | null = null;
  try {
    const provider = options.provider ?? getAiPhotoProvider(config);
    const result = await provider.generate({ prompt: reserved.prompt, requestId: grant.assetPublicId });
    usage = result.usage;
    bytes = await normalizeGeneratedImage(result.bytes);
  } catch (error) {
    const code = error instanceof AiPhotoProviderError ? error.code : "provider_error";
    const message =
      error instanceof AiPhotoProviderError ? error.message : "The image service could not generate this photo.";
    const diagnostics = error instanceof AiPhotoProviderError ? error.diagnostics : null;
    console.warn("AI photo generation failed", {
      tenantId: caller.tenantId,
      assetPublicId: grant.assetPublicId,
      failureCode: code,
      ...diagnostics,
    });
    const failed = await markGenerationFailed(db, caller, grant.assetPublicId, code, message, diagnostics);
    if (!failed) {
      throw error;
    }
    return {
      candidate: toCandidateView(caller.tenantId, input.menuPublicId, reserved.productPublicId, failed),
      created: true,
    };
  }

  try {
    await ingestProductImageUpload(db, caller.tenantId, reserved.productPublicId, grant.grantToken, bytes);
  } catch {
    const failed = await markGenerationFailed(
      db,
      caller,
      grant.assetPublicId,
      "storage_failed",
      "The generated image could not be stored.",
    );
    return {
      candidate: toCandidateView(caller.tenantId, input.menuPublicId, reserved.productPublicId, failed!),
      created: true,
    };
  }

  const stored = await withTenantContext(db, caller.tenantId, async (tx) => {
    const [asset] = await tx
      .select()
      .from(catalogueMediaAssets)
      .where(
        and(
          eq(catalogueMediaAssets.tenantId, caller.tenantId),
          eq(catalogueMediaAssets.publicId, grant.assetPublicId),
        ),
      )
      .limit(1)
      .for("update");
    const [updated] = await tx
      .update(catalogueMediaAssets)
      .set({
        generationMetadata: {
          ...metadataOf(asset!),
          completedAt: now().toISOString(),
          usage,
        },
        updatedAt: new Date(),
      })
      .where(eq(catalogueMediaAssets.id, asset!.id))
      .returning();
    return updated;
  });

  return {
    candidate: toCandidateView(caller.tenantId, input.menuPublicId, reserved.productPublicId, stored),
    created: true,
  };
}

async function loadCandidate(
  tx: DbTransaction,
  tenantId: string,
  assetPublicId: string,
  options: { lock: boolean },
) {
  const query = tx
    .select()
    .from(catalogueMediaAssets)
    .where(
      and(
        eq(catalogueMediaAssets.tenantId, tenantId),
        eq(catalogueMediaAssets.publicId, assetPublicId),
        eq(catalogueMediaAssets.sourceProvenance, "ai_generated"),
      ),
    )
    .limit(1);
  const [asset] = options.lock ? await query.for("update") : await query;
  if (!asset) {
    throw new AiPhotoError("candidate_not_found", "AI photo not found.", 404);
  }

  const [product] = await tx
    .select({ publicId: catalogueProducts.publicId })
    .from(catalogueProducts)
    .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.id, asset.productId)))
    .limit(1);
  if (!product) {
    throw new AiPhotoError("candidate_not_found", "AI photo not found.", 404);
  }
  return { asset, productPublicId: product.publicId };
}

export type AcceptAiPhotoInput = {
  menuPublicId: string;
  assetPublicId: string;
  /** Staff confirmed the image fairly represents the item. Required. */
  accuracyConfirmed: boolean;
  /** Required when the item already has an approved photo. */
  replaceExisting?: boolean;
};

/**
 * Accepts a pending candidate through the normal derivative pipeline and
 * attaches it as the draft product's primary photo. Publishing the menu is a
 * separate action, so nothing goes live here.
 */
export async function acceptMenuAiPhoto(
  db: DbClient,
  caller: AiPhotoCaller,
  input: AcceptAiPhotoInput,
  options: ServiceOptions = {},
): Promise<AiPhotoCandidateView> {
  requireAdministrator(caller);
  const now = options.now ?? (() => new Date());

  return withTenantContext(db, caller.tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, input.menuPublicId);
    const { asset, productPublicId } = await loadCandidate(tx, caller.tenantId, input.assetPublicId, { lock: true });
    const product = await requireMenuProduct(tx, caller.tenantId, input.menuPublicId, productPublicId);

    if (asset.status === "approved") {
      return toCandidateView(caller.tenantId, input.menuPublicId, productPublicId, asset);
    }
    if (asset.status !== "uploaded") {
      throw new AiPhotoError("candidate_not_reviewable", "This AI photo can no longer be accepted.", 409);
    }
    if (!input.accuracyConfirmed) {
      throw new AiPhotoError(
        "accuracy_review_required",
        "Confirm the image fairly represents the item before accepting it.",
        400,
      );
    }

    const metadata = metadataOf(asset);
    if (metadata.contextSha256 !== aiPhotoContextSha256(product.context)) {
      throw new AiPhotoError(
        "stale_candidate",
        "The item's name or description changed after this image was generated. Generate a new one.",
        409,
      );
    }

    const [lockedProduct] = await tx
      .select({ primaryMediaAssetId: catalogueProducts.primaryMediaAssetId })
      .from(catalogueProducts)
      .where(eq(catalogueProducts.id, product.id))
      .limit(1)
      .for("update");
    const existingThumbnails = await getApprovedThumbnailPublicIdsForProducts(tx, caller.tenantId, [
      { id: product.id, primaryMediaAssetId: lockedProduct?.primaryMediaAssetId ?? null },
    ]);
    const hasApprovedPhoto = existingThumbnails.has(product.id);
    if (hasApprovedPhoto && !input.replaceExisting) {
      throw new AiPhotoError(
        "existing_photo",
        "This item already has an approved photo. Confirm you want to replace it.",
        409,
      );
    }

    let replacedAssetPublicId: string | null = null;
    if (hasApprovedPhoto && lockedProduct?.primaryMediaAssetId) {
      const [replaced] = await tx
        .select({ publicId: catalogueMediaAssets.publicId })
        .from(catalogueMediaAssets)
        .where(eq(catalogueMediaAssets.id, lockedProduct.primaryMediaAssetId))
        .limit(1);
      replacedAssetPublicId = replaced?.publicId ?? null;
    }

    await processProductImageInTx(tx, caller.tenantId, productPublicId, asset.publicId, caller.subject);

    const [accepted] = await tx
      .update(catalogueMediaAssets)
      .set({
        generationMetadata: {
          ...metadata,
          review: {
            decision: "accepted",
            decidedBySubject: caller.subject,
            decidedAt: now().toISOString(),
            accuracyConfirmed: true,
            replacedAssetPublicId,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(catalogueMediaAssets.id, asset.id))
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.media.ai_photo_accepted",
      entityType: "catalogue_media_asset",
      entityPublicId: asset.publicId,
      changeSummary: { productPublicId, replacedAssetPublicId },
    });

    return toCandidateView(caller.tenantId, input.menuPublicId, productPublicId, accepted);
  });
}

/** Rejects a pending candidate. The product's current photo is untouched. */
export async function rejectMenuAiPhoto(
  db: DbClient,
  caller: AiPhotoCaller,
  input: { menuPublicId: string; assetPublicId: string },
  options: ServiceOptions = {},
): Promise<AiPhotoCandidateView> {
  const now = options.now ?? (() => new Date());

  return withTenantContext(db, caller.tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, input.menuPublicId);
    const { asset, productPublicId } = await loadCandidate(tx, caller.tenantId, input.assetPublicId, { lock: true });
    await requireMenuProduct(tx, caller.tenantId, input.menuPublicId, productPublicId);

    if (asset.status === "rejected") {
      return toCandidateView(caller.tenantId, input.menuPublicId, productPublicId, asset);
    }
    if (asset.status !== "uploaded") {
      throw new AiPhotoError("candidate_not_reviewable", "This AI photo can no longer be rejected.", 409);
    }

    const [rejected] = await tx
      .update(catalogueMediaAssets)
      .set({
        status: "rejected",
        generationMetadata: {
          ...metadataOf(asset),
          review: {
            decision: "rejected",
            decidedBySubject: caller.subject,
            decidedAt: now().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(catalogueMediaAssets.id, asset.id))
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId: caller.tenantId,
      actorSubject: caller.subject,
      actorClass: auditActorClassFromStaffRole(caller.membership.role),
      action: "catalogue.media.ai_photo_rejected",
      entityType: "catalogue_media_asset",
      entityPublicId: asset.publicId,
      changeSummary: { productPublicId },
    });

    return toCandidateView(caller.tenantId, input.menuPublicId, productPublicId, rejected);
  });
}

/** Staff-only preview of a pending candidate from private quarantine storage. */
export async function readMenuAiPhotoPreview(
  db: DbClient,
  caller: AiPhotoCaller,
  input: { menuPublicId: string; assetPublicId: string },
) {
  const path = await withTenantContext(db, caller.tenantId, async (tx) => {
    await assertMenuLocationAccess(tx, caller.tenantId, caller.membership, input.menuPublicId);
    const { asset, productPublicId } = await loadCandidate(tx, caller.tenantId, input.assetPublicId, { lock: false });
    await requireMenuProduct(tx, caller.tenantId, input.menuPublicId, productPublicId);
    if (asset.status !== "uploaded") {
      throw new AiPhotoError("candidate_not_found", "AI photo not found.", 404);
    }
    const [grant] = await tx
      .select({ privateStoragePath: catalogueMediaUploadGrants.privateStoragePath })
      .from(catalogueMediaUploadGrants)
      .where(
        and(
          eq(catalogueMediaUploadGrants.tenantId, caller.tenantId),
          eq(catalogueMediaUploadGrants.assetId, asset.id),
          eq(catalogueMediaUploadGrants.status, "used"),
        ),
      )
      .limit(1);
    if (!grant) {
      throw new AiPhotoError("candidate_not_found", "AI photo not found.", 404);
    }
    return grant.privateStoragePath;
  });

  return { bytes: await getMediaStorage().readPrivate(path), contentType: "image/jpeg" };
}
