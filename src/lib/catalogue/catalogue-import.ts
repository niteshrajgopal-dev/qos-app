import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueImportOperations,
  catalogueImportSourceLinks,
  catalogueProductTranslations,
  catalogueProducts,
  catalogueVariantPrices,
  catalogueVariants,
  type CatalogueImportApplyReport,
  type CatalogueImportColumnMapping,
  type CatalogueImportPreviewPayload,
  type CatalogueImportPreviewRow,
} from "@/db/schema";
import {
  parseSpreadsheetUpload,
  suggestColumnMapping,
} from "@/lib/catalogue/catalogue-import-parser";
import {
  normalizeImportRow,
  validateColumnMapping,
  validateConnectionKey,
} from "@/lib/catalogue/catalogue-import-validation";
import {
  CatalogueProductConflictError,
  createDraftProduct,
  updateDraftProduct,
} from "@/lib/catalogue/products";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class CatalogueImportError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CatalogueImportError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

function generateOperationPublicId() {
  return `imp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function buildPreviewHash(input: {
  fileFingerprint: string;
  connectionKey: string;
  columnMapping: CatalogueImportColumnMapping;
  rows: CatalogueImportPreviewRow[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        fileFingerprint: input.fileFingerprint,
        connectionKey: input.connectionKey,
        columnMapping: input.columnMapping,
        rows: input.rows,
      }),
    )
    .digest("hex");
}

function rowsEquivalent(
  existing: {
    internalName: string;
    displayNameEn: string;
    displayNameAr: string;
    amountMinor: number;
    currency: string;
    sku: string | null;
    barcode: string | null;
  },
  incoming: {
    internalName: string;
    displayNameEn: string;
    displayNameAr: string;
    amountMinor: number;
    currency: string;
    sku: string | null;
    barcode: string | null;
  },
) {
  return (
    existing.internalName === incoming.internalName &&
    existing.displayNameEn === incoming.displayNameEn &&
    existing.displayNameAr === incoming.displayNameAr &&
    existing.amountMinor === incoming.amountMinor &&
    existing.currency === incoming.currency &&
    existing.sku === incoming.sku &&
    existing.barcode === incoming.barcode
  );
}

async function loadExistingProductsBySourceIds(
  tx: DbClient,
  tenantId: string,
  connectionKey: string,
  sourceIds: string[],
) {
  if (sourceIds.length === 0) {
    return new Map<
      string,
      {
        productId: string;
        productPublicId: string;
        productVersion: number;
        internalName: string;
        sku: string | null;
        barcode: string | null;
        displayNameEn: string;
        displayNameAr: string;
        amountMinor: number;
        currency: string;
      }
    >();
  }

  const links = await tx
    .select({
      sourceId: catalogueImportSourceLinks.sourceId,
      productId: catalogueImportSourceLinks.productId,
    })
    .from(catalogueImportSourceLinks)
    .where(
      and(
        eq(catalogueImportSourceLinks.tenantId, tenantId),
        eq(catalogueImportSourceLinks.connectionKey, connectionKey),
        inArray(catalogueImportSourceLinks.sourceId, sourceIds),
      ),
    );

  if (links.length === 0) {
    return new Map();
  }

  const products = await tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        inArray(
          catalogueProducts.id,
          links.map((link) => link.productId),
        ),
      ),
    );

  const productById = new Map(products.map((product) => [product.id, product]));
  const translations = await tx
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        inArray(
          catalogueProductTranslations.productId,
          products.map((product) => product.id),
        ),
      ),
    );

  const variants = await tx
    .select({
      productId: catalogueVariants.productId,
      variantId: catalogueVariants.id,
    })
    .from(catalogueVariants)
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        eq(catalogueVariants.isDefault, true),
        inArray(
          catalogueVariants.productId,
          products.map((product) => product.id),
        ),
      ),
    );

  const prices = await tx
    .select()
    .from(catalogueVariantPrices)
    .where(
      and(
        eq(catalogueVariantPrices.tenantId, tenantId),
        inArray(
          catalogueVariantPrices.variantId,
          variants.map((variant) => variant.variantId),
        ),
      ),
    );

  const priceByVariantId = new Map(
    prices.map((price) => [price.variantId, price]),
  );
  const variantByProductId = new Map(
    variants.map((variant) => [variant.productId, variant.variantId]),
  );
  const translationsByProductId = new Map<
    string,
    { en: string; ar: string }
  >();

  for (const product of products) {
    translationsByProductId.set(product.id, { en: "", ar: "" });
  }

  for (const row of translations) {
    const bucket = translationsByProductId.get(row.productId);
    if (!bucket) {
      continue;
    }

    if (row.locale === "en") {
      bucket.en = row.displayName;
    }
    if (row.locale === "ar") {
      bucket.ar = row.displayName;
    }
  }

  const result = new Map<
    string,
    {
      productId: string;
      productPublicId: string;
      productVersion: number;
      internalName: string;
      sku: string | null;
      barcode: string | null;
      displayNameEn: string;
      displayNameAr: string;
      amountMinor: number;
      currency: string;
    }
  >();

  for (const link of links) {
    const product = productById.get(link.productId);
    if (!product) {
      continue;
    }

    const variantId = variantByProductId.get(product.id);
    const price = variantId ? priceByVariantId.get(variantId) : null;
    const translation = translationsByProductId.get(product.id);

    result.set(link.sourceId, {
      productId: product.id,
      productPublicId: product.publicId,
      productVersion: product.version,
      internalName: product.internalName,
      sku: product.sku,
      barcode: product.barcode,
      displayNameEn: translation?.en ?? "",
      displayNameAr: translation?.ar ?? "",
      amountMinor: price?.amountMinor ?? 0,
      currency: price?.currency ?? "AED",
    });
  }

  return result;
}

async function linkImportSourceToProduct(
  db: DbClient,
  tenantId: string,
  connectionKey: string,
  sourceId: string,
  productPublicId: string,
) {
  await withTenantContext(db, tenantId, async (tx) => {
    const [productRecord] = await tx
      .select({ id: catalogueProducts.id })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.publicId, productPublicId),
        ),
      )
      .limit(1);

    if (!productRecord) {
      return;
    }

    await tx.insert(catalogueImportSourceLinks).values({
      tenantId,
      connectionKey,
      sourceId,
      productId: productRecord.id,
    });
  });
}

function buildPreviewPayload(
  connectionKey: string,
  fileName: string,
  rows: CatalogueImportPreviewRow[],
): CatalogueImportPreviewPayload {
  return {
    connectionKey,
    fileName,
    rowCount: rows.length,
    rows,
    errorCount: rows.filter((row) => row.status === "error").length,
    createCount: rows.filter((row) => row.status === "create").length,
    updateCount: rows.filter((row) => row.status === "update").length,
    unchangedCount: rows.filter((row) => row.status === "unchanged").length,
    duplicateCount: rows.filter((row) => row.status === "duplicate").length,
  };
}

export async function previewCatalogueImport(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  input: {
    fileName: string;
    bytes: Buffer;
    connectionKey: string;
    columnMapping?: CatalogueImportColumnMapping;
    idempotencyKey: string;
  },
) {
  const connectionKey = validateConnectionKey(input.connectionKey);
  const parsed = await parseSpreadsheetUpload({
    fileName: input.fileName,
    bytes: input.bytes,
  });
  const columnMapping = validateColumnMapping(
    input.columnMapping ?? suggestColumnMapping(parsed.headers),
    parsed.headers,
  );

  return withTenantContext(db, tenantId, async (tx) => {
    const [existingByIdempotency] = await tx
      .select()
      .from(catalogueImportOperations)
      .where(
        and(
          eq(catalogueImportOperations.tenantId, tenantId),
          eq(catalogueImportOperations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existingByIdempotency?.status === "preview_ready") {
      return {
        operationPublicId: existingByIdempotency.operationPublicId,
        previewHash: existingByIdempotency.previewHash,
        warnings: [],
        headers: Object.values(existingByIdempotency.columnMapping).filter(Boolean),
        suggestedMapping: existingByIdempotency.columnMapping,
        preview: existingByIdempotency.previewPayload,
        replayed: true,
      };
    }

    const seenSourceIds = new Set<string>();
    const normalizedRows = [];
    const previewRows: CatalogueImportPreviewRow[] = [];

    for (const [index, row] of parsed.rows.entries()) {
      const sourceRow = index + 2;

      try {
        const normalized = normalizeImportRow(row, columnMapping, sourceRow);
        if (seenSourceIds.has(normalized.sourceId)) {
          previewRows.push({
            sourceRow,
            sourceId: normalized.sourceId,
            status: "duplicate",
            reason: "Duplicate sourceId within the import file.",
            productPublicId: null,
            expectedProductVersion: null,
            internalName: normalized.internalName,
            displayNameEn: normalized.displayNameEn,
            displayNameAr: normalized.displayNameAr,
            amountMinor: normalized.amountMinor,
            currency: normalized.currency,
          });
          continue;
        }

        seenSourceIds.add(normalized.sourceId);
        normalizedRows.push(normalized);
      } catch (error) {
        previewRows.push({
          sourceRow,
          sourceId: row[columnMapping.sourceId]?.trim() || `row_${sourceRow}`,
          status: "error",
          reason:
            error instanceof CatalogueValidationError
              ? error.message
              : "Invalid row.",
          productPublicId: null,
          expectedProductVersion: null,
          internalName: null,
          displayNameEn: null,
          displayNameAr: null,
          amountMinor: null,
          currency: null,
        });
      }
    }

    const existingBySourceId = await loadExistingProductsBySourceIds(
      tx,
      tenantId,
      connectionKey,
      normalizedRows.map((row) => row.sourceId),
    );

    for (const normalized of normalizedRows) {
      const existing = existingBySourceId.get(normalized.sourceId);
      if (!existing) {
        previewRows.push({
          sourceRow: normalized.sourceRow,
          sourceId: normalized.sourceId,
          status: "create",
          reason: null,
          productPublicId: null,
          expectedProductVersion: null,
          internalName: normalized.internalName,
          displayNameEn: normalized.displayNameEn,
          displayNameAr: normalized.displayNameAr,
          amountMinor: normalized.amountMinor,
          currency: normalized.currency,
        });
        continue;
      }

      const unchanged = rowsEquivalent(existing, normalized);
      previewRows.push({
        sourceRow: normalized.sourceRow,
        sourceId: normalized.sourceId,
        status: unchanged ? "unchanged" : "update",
        reason: unchanged ? "No draft changes detected." : null,
        productPublicId: existing.productPublicId,
        expectedProductVersion: existing.productVersion,
        internalName: normalized.internalName,
        displayNameEn: normalized.displayNameEn,
        displayNameAr: normalized.displayNameAr,
        amountMinor: normalized.amountMinor,
        currency: normalized.currency,
      });
    }

    previewRows.sort((left, right) => left.sourceRow - right.sourceRow);

    const previewPayload = buildPreviewPayload(
      connectionKey,
      parsed.fileName,
      previewRows,
    );
    const previewHash = buildPreviewHash({
      fileFingerprint: parsed.fileFingerprint,
      connectionKey,
      columnMapping,
      rows: previewRows,
    });

    const operationPublicId = generateOperationPublicId();
    const [operation] = await tx
      .insert(catalogueImportOperations)
      .values({
        tenantId,
        operationPublicId,
        staffSubject,
        connectionKey,
        fileName: parsed.fileName,
        fileFingerprint: parsed.fileFingerprint,
        columnMapping,
        previewPayload,
        previewHash,
        status: "preview_ready",
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: staffSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "catalogue.import.preview",
      entityType: "catalogue_import_operation",
      entityPublicId: operation.operationPublicId,
      changeSummary: {
        connectionKey,
        fileName: parsed.fileName,
        rowCount: previewPayload.rowCount,
        createCount: previewPayload.createCount,
        updateCount: previewPayload.updateCount,
        errorCount: previewPayload.errorCount,
      },
    });

    return {
      operationPublicId: operation.operationPublicId,
      previewHash,
      warnings: parsed.warnings,
      headers: parsed.headers,
      suggestedMapping: suggestColumnMapping(parsed.headers),
      preview: previewPayload,
      replayed: false,
    };
  });
}

export async function applyCatalogueImport(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  staffSubject: string,
  input: {
    operationPublicId: string;
    previewHash: string;
    idempotencyKey: string;
  },
) {
  const operation = await withTenantContext(db, tenantId, async (tx) => {
    const [existingByIdempotency] = await tx
      .select()
      .from(catalogueImportOperations)
      .where(
        and(
          eq(catalogueImportOperations.tenantId, tenantId),
          eq(catalogueImportOperations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (
      existingByIdempotency &&
      existingByIdempotency.operationPublicId !== input.operationPublicId
    ) {
      throw new CatalogueImportError(
        "idempotencyKey was already used for a different import operation.",
        409,
        "idempotencyKey",
      );
    }

    const [loadedOperation] = await tx
      .select()
      .from(catalogueImportOperations)
      .where(
        and(
          eq(catalogueImportOperations.tenantId, tenantId),
          eq(
            catalogueImportOperations.operationPublicId,
            input.operationPublicId,
          ),
        ),
      )
      .limit(1);

    if (!loadedOperation) {
      throw new CatalogueImportError(
        "Import operation not found.",
        404,
        "operationPublicId",
      );
    }

    if (loadedOperation.previewHash !== input.previewHash) {
      throw new CatalogueImportError(
        "Preview hash mismatch. Re-run preview before applying.",
        409,
        "previewHash",
      );
    }

    if (loadedOperation.status === "applied" && loadedOperation.applyReport) {
      return {
        kind: "replay" as const,
        operationPublicId: loadedOperation.operationPublicId,
        report: loadedOperation.applyReport,
      };
    }

    if (loadedOperation.status !== "preview_ready") {
      throw new CatalogueImportError(
        "Import operation is not ready to apply.",
        409,
        "operationPublicId",
      );
    }

    return { kind: "apply" as const, operation: loadedOperation };
  });

  if (operation.kind === "replay") {
    return {
      operationPublicId: operation.operationPublicId,
      report: operation.report,
      replayed: true,
    };
  }

  const loadedOperation = operation.operation;
  const reportRows: CatalogueImportApplyReport["rows"] = [];
  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;
  let skippedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;

  for (const row of loadedOperation.previewPayload.rows) {
    if (row.status === "error" || row.status === "duplicate") {
      skippedCount += 1;
      reportRows.push({
        sourceRow: row.sourceRow,
        sourceId: row.sourceId,
        status: "skipped",
        productPublicId: row.productPublicId,
        reason: row.reason,
      });
      continue;
    }

    if (row.status === "unchanged") {
      unchangedCount += 1;
      reportRows.push({
        sourceRow: row.sourceRow,
        sourceId: row.sourceId,
        status: "unchanged",
        productPublicId: row.productPublicId,
        reason: row.reason,
      });
      continue;
    }

    if (
      row.amountMinor == null ||
      !row.currency ||
      !row.internalName ||
      !row.displayNameEn ||
      !row.displayNameAr
    ) {
      errorCount += 1;
      reportRows.push({
        sourceRow: row.sourceRow,
        sourceId: row.sourceId,
        status: "error",
        productPublicId: row.productPublicId,
        reason: "Preview row is missing required values.",
      });
      continue;
    }

    try {
      if (row.status === "create") {
        const created = await createDraftProduct(db, tenantId, membership, {
          internalName: row.internalName,
          sku: null,
          barcode: null,
          translations: {
            en: { displayName: row.displayNameEn, description: null },
            ar: { displayName: row.displayNameAr, description: null },
          },
          defaultVariant: {
            amountMinor: row.amountMinor,
            currency: row.currency,
          },
          provenance: "imported",
        });

        await linkImportSourceToProduct(
          db,
          tenantId,
          loadedOperation.connectionKey,
          row.sourceId,
          created.publicId,
        );

        createCount += 1;
        reportRows.push({
          sourceRow: row.sourceRow,
          sourceId: row.sourceId,
          status: "created",
          productPublicId: created.publicId,
          reason: null,
        });
        continue;
      }

      if (!row.productPublicId || row.expectedProductVersion == null) {
        throw new CatalogueImportError(
          "Update preview row is missing product version metadata.",
          500,
        );
      }

      const updated = await updateDraftProduct(
        db,
        tenantId,
        membership,
        row.productPublicId,
        {
          expectedVersion: row.expectedProductVersion,
          internalName: row.internalName,
          translations: {
            en: { displayName: row.displayNameEn },
            ar: { displayName: row.displayNameAr },
          },
          defaultVariant: {
            amountMinor: row.amountMinor,
          },
        },
        staffSubject,
      );

      updateCount += 1;
      reportRows.push({
        sourceRow: row.sourceRow,
        sourceId: row.sourceId,
        status: "updated",
        productPublicId: updated.publicId,
        reason: null,
      });
    } catch (error) {
      if (
        error instanceof CatalogueProductConflictError ||
        (error instanceof Error &&
          (error.name === "CatalogueProductConflictError" ||
            error.message.includes("updated elsewhere")))
      ) {
        conflictCount += 1;
        reportRows.push({
          sourceRow: row.sourceRow,
          sourceId: row.sourceId,
          status: "conflict",
          productPublicId: row.productPublicId,
          reason: error instanceof Error ? error.message : "Version conflict.",
        });
        continue;
      }

      errorCount += 1;
      reportRows.push({
        sourceRow: row.sourceRow,
        sourceId: row.sourceId,
        status: "error",
        productPublicId: row.productPublicId,
        reason: error instanceof Error ? error.message : "Apply failed.",
      });
    }
  }

  const report: CatalogueImportApplyReport = {
    appliedAt: new Date().toISOString(),
    createCount,
    updateCount,
    unchangedCount,
    skippedCount,
    conflictCount,
    errorCount,
    rows: reportRows,
  };

  await withTenantContext(db, tenantId, async (tx) => {
    await tx
      .update(catalogueImportOperations)
      .set({
        status: errorCount > 0 || conflictCount > 0 ? "failed" : "applied",
        applyReport: report,
        completedAt: new Date(),
      })
      .where(eq(catalogueImportOperations.id, loadedOperation.id));

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: staffSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "catalogue.import.apply",
      entityType: "catalogue_import_operation",
      entityPublicId: loadedOperation.operationPublicId,
      changeSummary: {
        connectionKey: loadedOperation.connectionKey,
        createCount,
        updateCount,
        unchangedCount,
        skippedCount,
        conflictCount,
        errorCount,
      },
    });
  });

  return {
    operationPublicId: loadedOperation.operationPublicId,
    report,
    replayed: false,
  };
}
