import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueMenuExtractionPages,
  catalogueMenuExtractionSources,
} from "@/db/schema";
import {
  MENU_EXTRACTION_LIMITS,
  readMenuExtractionConfig,
} from "@/lib/catalogue/menu-extraction/config";
import { MediaValidationError } from "@/lib/media/validation";
import { getMediaStorage } from "@/lib/media/storage";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import { requireAdministratorMembership, type ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { assertTenantActive } from "@/lib/tenant/tenant-status";

export class MenuExtractionUploadError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "MenuExtractionUploadError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

function generateSourcePublicId() {
  return `mex_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function contentHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function detectMimeType(fileName: string, declared: string | null) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return MENU_EXTRACTION_LIMITS.allowedPdfMimeType;
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return declared?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function uploadMenuExtractionSource(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  input: { fileName: string; bytes: Buffer; contentType: string | null },
) {
  await requireAdministratorMembership(db, tenantId, staffSubject);

  const config = readMenuExtractionConfig();
  if (input.bytes.byteLength === 0) {
    throw new MenuExtractionUploadError("Uploaded file is empty.", 400, "file");
  }
  if (input.bytes.byteLength > config.maxUploadBytes) {
    throw new MenuExtractionUploadError(
      "Uploaded file exceeds the configured size limit.",
      413,
      "file",
    );
  }

  const mimeType = detectMimeType(input.fileName, input.contentType);
  const allowedImages = MENU_EXTRACTION_LIMITS.allowedImageMimeTypes as readonly string[];
  if (
    mimeType !== MENU_EXTRACTION_LIMITS.allowedPdfMimeType &&
    !allowedImages.includes(mimeType)
  ) {
    throw new MenuExtractionUploadError(
      "Only JPEG, PNG, or PDF menu sources are supported.",
      400,
      "contentType",
    );
  }

  const hash = contentHash(input.bytes);

  return withTenantContext(db, tenantId, async (tx) => {
    await assertTenantActive(tx, tenantId);

    const [existing] = await tx
      .select()
      .from(catalogueMenuExtractionSources)
      .where(
        and(
          eq(catalogueMenuExtractionSources.tenantId, tenantId),
          eq(catalogueMenuExtractionSources.contentHash, hash),
        ),
      )
      .limit(1);

    if (existing) {
      const pages = await tx
        .select()
        .from(catalogueMenuExtractionPages)
        .where(
          and(
            eq(catalogueMenuExtractionPages.tenantId, tenantId),
            eq(catalogueMenuExtractionPages.sourceId, existing.id),
          ),
        );
      return {
        sourcePublicId: existing.publicId,
        contentHash: existing.contentHash,
        pageCount: existing.pageCount,
        replayed: true,
        pages: pages.map((page) => ({
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
        })),
      };
    }

    let rasterized;
    try {
      const { rasterizeMenuUpload } = await import("@/lib/catalogue/menu-extraction/rasterize");
      rasterized = await rasterizeMenuUpload(input.bytes, mimeType, config);
    } catch (error) {
      if (error instanceof MediaValidationError) {
        throw new MenuExtractionUploadError(error.message, 400, error.field);
      }
      throw error;
    }

    if (rasterized.pages.length === 0) {
      throw new MenuExtractionUploadError("No readable pages were found in the upload.", 400);
    }
    if (rasterized.pages.length > config.maxPages) {
      throw new MenuExtractionUploadError(
        `Menu sources may contain at most ${config.maxPages} pages.`,
        413,
        "file",
      );
    }

    const storage = getMediaStorage();
    const publicId = generateSourcePublicId();
    const originalPath = `menu-extraction/${tenantId}/${publicId}/original`;
    await storage.writePrivate(originalPath, input.bytes);

    const [source] = await tx
      .insert(catalogueMenuExtractionSources)
      .values({
        tenantId,
        publicId,
        contentHash: hash,
        fileName: input.fileName,
        mimeType,
        originalStoragePath: originalPath,
        pageCount: rasterized.pages.length,
        status: "ready",
        uploadedBySubject: staffSubject,
      })
      .returning();

    const pageRows = [];
    for (const page of rasterized.pages) {
      const pagePath = `menu-extraction/${tenantId}/${publicId}/pages/${page.pageNumber}.jpg`;
      await storage.writePrivate(pagePath, page.bytes);
      pageRows.push({
        tenantId,
        sourceId: source!.id,
        pageNumber: page.pageNumber,
        storagePath: pagePath,
        width: page.width,
        height: page.height,
        contentHash: contentHash(page.bytes),
      });
    }

    await tx.insert(catalogueMenuExtractionPages).values(pageRows);

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: staffSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "catalogue.menu_extraction.uploaded",
      entityType: "catalogue_menu_extraction_source",
      entityPublicId: publicId,
      changeSummary: {
        fileName: input.fileName,
        mimeType,
        pageCount: rasterized.pages.length,
        contentHash: hash,
      },
    });

    return {
      sourcePublicId: publicId,
      contentHash: hash,
      pageCount: rasterized.pages.length,
      replayed: false,
      pages: rasterized.pages.map((page) => ({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
      })),
    };
  });
}

export { loadMenuExtractionSource, readMenuExtractionPageBytes } from "@/lib/catalogue/menu-extraction/source-store";
