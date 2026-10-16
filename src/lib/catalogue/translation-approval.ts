import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  agentRunCatalogueTranslationDecisions,
  agentRuns,
  catalogueProducts,
  catalogueProductTranslations,
} from "@/db/schema";
import type { ProductLocale } from "@/lib/catalogue/validation";
import { recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import {
  requireAdministratorMembership,
  StaffAuthorizationError,
} from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class TranslationApprovalError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "TranslationApprovalError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class TranslationApprovalConflictError extends TranslationApprovalError {
  constructor(message: string, field?: string) {
    super(message, 409, field);
    this.name = "TranslationApprovalConflictError";
  }
}

export type ProductTranslationReviewView = {
  locale: ProductLocale;
  displayName: string;
  description: string | null;
  translationVersion: number;
  approvalStatus: "draft" | "approved";
  provenance: string;
  approvedBySubject: string | null;
  approvedAt: string | null;
  approvedTranslationVersion: number | null;
  approvedSourceTranslationVersion: number | null;
  lastApprovedBySubject: string | null;
  lastApprovedAt: string | null;
  lastApprovedTranslationVersion: number | null;
  lastApprovedSourceTranslationVersion: number | null;
};

export type ProductTranslationReviewBundle = {
  productPublicId: string;
  internalName: string;
  sourceLocale: "en";
  translations: Record<ProductLocale, ProductTranslationReviewView>;
};

export type PendingAiTranslationApprovalItem = {
  productPublicId: string;
  productInternalName: string;
  locale: ProductLocale;
  translationVersion: number;
  sourceTranslationVersion: number | null;
  proposed: {
    displayName: string;
    description: string | null;
  };
  sourceCopy: {
    locale: "en";
    displayName: string;
    description: string | null;
    translationVersion: number;
  } | null;
  lastApproved: {
    translationVersion: number | null;
    approvedAt: string | null;
    approvedBySubject: string | null;
  };
  acceptedBySubject: string | null;
  acceptedAt: string | null;
  updatedAt: string;
};

export type PendingAiTranslationApprovalList = {
  items: PendingAiTranslationApprovalItem[];
};

export type PublishTranslationValidationIssue = {
  productPublicId: string;
  field: string;
  message: string;
};

function mapApprovalError(error: unknown): never {
  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof TranslationApprovalError) {
    throw error;
  }

  throw error;
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function mapTranslationRow(
  row: typeof catalogueProductTranslations.$inferSelect,
): ProductTranslationReviewView {
  return {
    locale: row.locale as ProductLocale,
    displayName: row.displayName,
    description: row.description,
    translationVersion: row.translationVersion,
    approvalStatus: row.approvalStatus,
    provenance: row.provenance,
    approvedBySubject: row.approvedBySubject,
    approvedAt: toIso(row.approvedAt),
    approvedTranslationVersion: row.approvedTranslationVersion,
    approvedSourceTranslationVersion: row.approvedSourceTranslationVersion,
    lastApprovedBySubject: row.lastApprovedBySubject,
    lastApprovedAt: toIso(row.lastApprovedAt),
    lastApprovedTranslationVersion: row.lastApprovedTranslationVersion,
    lastApprovedSourceTranslationVersion:
      row.lastApprovedSourceTranslationVersion,
  };
}

async function loadProductWithTranslations(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
) {
  const [product] = await tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);

  if (!product) {
    return null;
  }

  const translationRows = await tx
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        eq(catalogueProductTranslations.productId, product.id),
      ),
    );

  return { product, translationRows };
}

function emptyTranslation(locale: ProductLocale): ProductTranslationReviewView {
  return {
    locale,
    displayName: "",
    description: null,
    translationVersion: 1,
    approvalStatus: "draft",
    provenance: "operator_entered",
    approvedBySubject: null,
    approvedAt: null,
    approvedTranslationVersion: null,
    approvedSourceTranslationVersion: null,
    lastApprovedBySubject: null,
    lastApprovedAt: null,
    lastApprovedTranslationVersion: null,
    lastApprovedSourceTranslationVersion: null,
  };
}

async function loadLatestTranslationAcceptance(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
  locale: ProductLocale,
) {
  const [row] = await tx
    .select({
      decidedBySubject: agentRunCatalogueTranslationDecisions.decidedBySubject,
      createdAt: agentRunCatalogueTranslationDecisions.createdAt,
    })
    .from(agentRunCatalogueTranslationDecisions)
    .innerJoin(
      agentRuns,
      and(
        eq(agentRuns.tenantId, agentRunCatalogueTranslationDecisions.tenantId),
        eq(agentRuns.id, agentRunCatalogueTranslationDecisions.agentRunId),
      ),
    )
    .where(
      and(
        eq(agentRunCatalogueTranslationDecisions.tenantId, tenantId),
        eq(agentRunCatalogueTranslationDecisions.decision, "accepted"),
        eq(agentRuns.subjectType, "product"),
        eq(agentRuns.subjectPublicId, productPublicId),
        sql`${agentRuns.requestSummary} ->> 'targetLocale' = ${locale}`,
      ),
    )
    .orderBy(desc(agentRunCatalogueTranslationDecisions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function listPendingAiTranslationApprovals(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
): Promise<PendingAiTranslationApprovalList> {
  try {
    await requireAdministratorMembership(db, tenantId, adminSubject);

    return await withTenantContext(db, tenantId, async (tx) => {
      const pendingRows = await tx
        .select({
          productPublicId: catalogueProducts.publicId,
          productInternalName: catalogueProducts.internalName,
          productId: catalogueProducts.id,
          locale: catalogueProductTranslations.locale,
          displayName: catalogueProductTranslations.displayName,
          description: catalogueProductTranslations.description,
          translationVersion: catalogueProductTranslations.translationVersion,
          updatedAt: catalogueProductTranslations.updatedAt,
          lastApprovedTranslationVersion:
            catalogueProductTranslations.lastApprovedTranslationVersion,
          lastApprovedAt: catalogueProductTranslations.lastApprovedAt,
          lastApprovedBySubject:
            catalogueProductTranslations.lastApprovedBySubject,
        })
        .from(catalogueProductTranslations)
        .innerJoin(
          catalogueProducts,
          and(
            eq(catalogueProducts.tenantId, catalogueProductTranslations.tenantId),
            eq(catalogueProducts.id, catalogueProductTranslations.productId),
          ),
        )
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, tenantId),
            eq(catalogueProductTranslations.approvalStatus, "draft"),
            eq(catalogueProductTranslations.provenance, "ai_generated"),
          ),
        )
        .orderBy(desc(catalogueProductTranslations.updatedAt));

      const englishByProduct = new Map<
        string,
        { translationVersion: number; displayName: string; description: string | null }
      >();

      if (pendingRows.length > 0) {
        const productIds = [...new Set(pendingRows.map((row) => row.productId))];
        const englishRows = await tx
          .select({
            productId: catalogueProductTranslations.productId,
            translationVersion: catalogueProductTranslations.translationVersion,
            displayName: catalogueProductTranslations.displayName,
            description: catalogueProductTranslations.description,
          })
          .from(catalogueProductTranslations)
          .where(
            and(
              eq(catalogueProductTranslations.tenantId, tenantId),
              inArray(catalogueProductTranslations.productId, productIds),
              eq(catalogueProductTranslations.locale, "en"),
            ),
          );

        for (const row of englishRows) {
          englishByProduct.set(row.productId, {
            translationVersion: row.translationVersion,
            displayName: row.displayName,
            description: row.description,
          });
        }
      }

      const items: PendingAiTranslationApprovalItem[] = [];

      for (const row of pendingRows) {
        const locale = row.locale as ProductLocale;
        if (locale !== "en" && locale !== "ar") {
          continue;
        }

        const english = englishByProduct.get(row.productId);
        const acceptance = await loadLatestTranslationAcceptance(
          tx,
          tenantId,
          row.productPublicId,
          locale,
        );

        const sourceTranslationVersion =
          locale === "ar" ? english?.translationVersion ?? null : row.translationVersion;

        items.push({
          productPublicId: row.productPublicId,
          productInternalName: row.productInternalName,
          locale,
          translationVersion: row.translationVersion,
          sourceTranslationVersion,
          proposed: {
            displayName: row.displayName,
            description: row.description,
          },
          sourceCopy:
            english != null
              ? {
                  locale: "en",
                  displayName: english.displayName,
                  description: english.description,
                  translationVersion: english.translationVersion,
                }
              : null,
          lastApproved: {
            translationVersion: row.lastApprovedTranslationVersion,
            approvedAt: toIso(row.lastApprovedAt),
            approvedBySubject: row.lastApprovedBySubject,
          },
          acceptedBySubject: acceptance?.decidedBySubject ?? null,
          acceptedAt: acceptance ? toIso(acceptance.createdAt) : null,
          updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
        });
      }

      return { items };
    });
  } catch (error) {
    return mapApprovalError(error);
  }
}

export async function getProductTranslationReview(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
): Promise<ProductTranslationReviewBundle | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const loaded = await loadProductWithTranslations(
      tx,
      tenantId,
      productPublicId,
    );

    if (!loaded) {
      return null;
    }

    const translations: Record<ProductLocale, ProductTranslationReviewView> = {
      en: emptyTranslation("en"),
      ar: emptyTranslation("ar"),
    };

    for (const row of loaded.translationRows) {
      const locale = row.locale as ProductLocale;
      if (locale !== "en" && locale !== "ar") {
        continue;
      }

      translations[locale] = mapTranslationRow(row);
    }

    return {
      productPublicId,
      internalName: loaded.product.internalName,
      sourceLocale: "en",
      translations,
    };
  });
}

type ReviewMutationInput = {
  expectedTranslationVersion: number;
};

function assertLocale(locale: string): ProductLocale {
  if (locale !== "en" && locale !== "ar") {
    throw new TranslationApprovalError("Unsupported translation locale.", 400);
  }

  return locale;
}

export async function approveProductTranslation(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  productPublicId: string,
  localeInput: string,
  input: ReviewMutationInput,
): Promise<ProductTranslationReviewBundle> {
  const locale = assertLocale(localeInput);

  try {
    await requireAdministratorMembership(db, tenantId, adminSubject);

    return await withTenantContext(db, tenantId, async (tx) => {
      const loaded = await loadProductWithTranslations(
        tx,
        tenantId,
        productPublicId,
      );

      if (!loaded) {
        throw new TranslationApprovalError("Product not found.", 404);
      }

      const translation = loaded.translationRows.find(
        (row) => row.locale === locale,
      );

      if (!translation) {
        throw new TranslationApprovalError(
          `Missing ${locale.toUpperCase()} translation for product.`,
          500,
        );
      }

      if (
        translation.translationVersion !== input.expectedTranslationVersion
      ) {
        throw new TranslationApprovalConflictError(
          `${locale.toUpperCase()} translation was updated elsewhere. Reload and try again.`,
          `translations.${locale}.expectedTranslationVersion`,
        );
      }

      if (!translation.displayName.trim()) {
        throw new TranslationApprovalError(
          `${locale.toUpperCase()} display name is required before approval.`,
          400,
          `translations.${locale}.displayName`,
        );
      }

      let approvedSourceTranslationVersion: number | null = null;

      if (locale === "ar") {
        const english = loaded.translationRows.find((row) => row.locale === "en");

        if (!english?.displayName.trim()) {
          throw new TranslationApprovalError(
            "English source copy is required before Arabic approval.",
            400,
            "translations.en.displayName",
          );
        }

        approvedSourceTranslationVersion = english.translationVersion;
      }

      const approvedAt = new Date();

      const [updated] = await tx
        .update(catalogueProductTranslations)
        .set({
          approvalStatus: "approved",
          approvedBySubject: adminSubject,
          approvedAt,
          approvedTranslationVersion: translation.translationVersion,
          approvedSourceTranslationVersion,
          lastApprovedBySubject: adminSubject,
          lastApprovedAt: approvedAt,
          lastApprovedTranslationVersion: translation.translationVersion,
          lastApprovedSourceTranslationVersion: approvedSourceTranslationVersion,
          updatedAt: approvedAt,
        })
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, tenantId),
            eq(catalogueProductTranslations.id, translation.id),
            eq(
              catalogueProductTranslations.translationVersion,
              input.expectedTranslationVersion,
            ),
          ),
        )
        .returning({ id: catalogueProductTranslations.id });

      if (!updated) {
        throw new TranslationApprovalConflictError(
          `${locale.toUpperCase()} translation was updated elsewhere. Reload and try again.`,
          `translations.${locale}.expectedTranslationVersion`,
        );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: adminSubject,
        actorClass: "staff_administrator",
        action: "catalogue.translation.approve",
        entityType: "product_translation",
        entityPublicId: `${productPublicId}:${locale}`,
        entityVersion: translation.translationVersion,
        changeSummary: {
          locale,
          productPublicId,
          translationVersion: translation.translationVersion,
          approvedSourceTranslationVersion,
        },
      });

      const review = await getProductTranslationReview(
        tx,
        tenantId,
        productPublicId,
      );

      if (!review) {
        throw new TranslationApprovalError(
          "Unable to load translation review.",
          500,
        );
      }

      return review;
    });
  } catch (error) {
    return mapApprovalError(error);
  }
}

export async function rejectProductTranslation(
  db: DbClient,
  tenantId: string,
  adminSubject: string,
  productPublicId: string,
  localeInput: string,
  input: ReviewMutationInput,
): Promise<ProductTranslationReviewBundle> {
  const locale = assertLocale(localeInput);

  try {
    await requireAdministratorMembership(db, tenantId, adminSubject);

    return await withTenantContext(db, tenantId, async (tx) => {
      const loaded = await loadProductWithTranslations(
        tx,
        tenantId,
        productPublicId,
      );

      if (!loaded) {
        throw new TranslationApprovalError("Product not found.", 404);
      }

      const translation = loaded.translationRows.find(
        (row) => row.locale === locale,
      );

      if (!translation) {
        throw new TranslationApprovalError(
          `Missing ${locale.toUpperCase()} translation for product.`,
          500,
        );
      }

      if (
        translation.translationVersion !== input.expectedTranslationVersion
      ) {
        throw new TranslationApprovalConflictError(
          `${locale.toUpperCase()} translation was updated elsewhere. Reload and try again.`,
          `translations.${locale}.expectedTranslationVersion`,
        );
      }

      const [updated] = await tx
        .update(catalogueProductTranslations)
        .set({
          approvalStatus: "draft",
          approvedBySubject: null,
          approvedAt: null,
          approvedTranslationVersion: null,
          approvedSourceTranslationVersion: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, tenantId),
            eq(catalogueProductTranslations.id, translation.id),
            eq(
              catalogueProductTranslations.translationVersion,
              input.expectedTranslationVersion,
            ),
          ),
        )
        .returning({ id: catalogueProductTranslations.id });

      if (!updated) {
        throw new TranslationApprovalConflictError(
          `${locale.toUpperCase()} translation was updated elsewhere. Reload and try again.`,
          `translations.${locale}.expectedTranslationVersion`,
        );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: adminSubject,
        actorClass: "staff_administrator",
        action: "catalogue.translation.reject",
        entityType: "product_translation",
        entityPublicId: `${productPublicId}:${locale}`,
        entityVersion: translation.translationVersion,
        changeSummary: {
          locale,
          productPublicId,
          translationVersion: translation.translationVersion,
        },
      });

      const review = await getProductTranslationReview(
        tx,
        tenantId,
        productPublicId,
      );

      if (!review) {
        throw new TranslationApprovalError(
          "Unable to load translation review.",
          500,
        );
      }

      return review;
    });
  } catch (error) {
    return mapApprovalError(error);
  }
}

export async function invalidateArabicApprovalAfterEnglishChange(
  tx: DbClient,
  tenantId: string,
  productId: string,
) {
  const [arabic] = await tx
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        eq(catalogueProductTranslations.productId, productId),
        eq(catalogueProductTranslations.locale, "ar"),
      ),
    )
    .limit(1);

  if (!arabic || arabic.approvalStatus !== "approved") {
    return;
  }

  await tx
    .update(catalogueProductTranslations)
    .set({
      approvalStatus: "draft",
      approvedBySubject: null,
      approvedAt: null,
      approvedTranslationVersion: null,
      approvedSourceTranslationVersion: null,
      updatedAt: new Date(),
    })
    .where(eq(catalogueProductTranslations.id, arabic.id));
}

export async function validateProductTranslationsForPublish(
  tx: DbClient,
  tenantId: string,
  productPublicIds: string[],
): Promise<PublishTranslationValidationIssue[]> {
  if (productPublicIds.length === 0) {
    return [];
  }

  const uniquePublicIds = [...new Set(productPublicIds)];

  const products = await tx
    .select({
      id: catalogueProducts.id,
      publicId: catalogueProducts.publicId,
    })
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        inArray(catalogueProducts.publicId, uniquePublicIds),
      ),
    );

  const productIdByPublicId = new Map(
    products.map((product) => [product.publicId, product.id]),
  );

  const issues: PublishTranslationValidationIssue[] = [];

  for (const productPublicId of uniquePublicIds) {
    const productId = productIdByPublicId.get(productPublicId);

    if (!productId) {
      issues.push({
        productPublicId,
        field: "productPublicId",
        message: "Menu references a product that no longer exists.",
      });
      continue;
    }

    const translationRows = await tx
      .select()
      .from(catalogueProductTranslations)
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, tenantId),
          eq(catalogueProductTranslations.productId, productId),
        ),
      );

    issues.push(
      ...evaluateProductTranslationsForPublish(productPublicId, translationRows),
    );
  }

  return issues;
}

export type PublishTranslationFacts = Pick<
  typeof catalogueProductTranslations.$inferSelect,
  | "locale"
  | "displayName"
  | "approvalStatus"
  | "translationVersion"
  | "approvedSourceTranslationVersion"
>;

export function evaluateProductTranslationsForPublish(
  productPublicId: string,
  translationRows: PublishTranslationFacts[],
): PublishTranslationValidationIssue[] {
  const issues: PublishTranslationValidationIssue[] = [];
  const english = translationRows.find((row) => row.locale === "en");
  const arabic = translationRows.find((row) => row.locale === "ar");

  for (const locale of ["en", "ar"] as const) {
    const translation = locale === "en" ? english : arabic;
    const field = `products.${productPublicId}.translations.${locale}`;

    if (!translation?.displayName.trim()) {
      issues.push({
        productPublicId,
        field,
        message: `${locale.toUpperCase()} display name is required before publishing.`,
      });
      continue;
    }

    if (translation.approvalStatus !== "approved") {
      issues.push({
        productPublicId,
        field,
        message: `${locale.toUpperCase()} translation requires Administrator approval before publishing.`,
      });
    }
  }

  if (
    arabic?.approvalStatus === "approved" &&
    english &&
    arabic.approvedSourceTranslationVersion != null &&
    arabic.approvedSourceTranslationVersion !== english.translationVersion
  ) {
    issues.push({
      productPublicId,
      field: `products.${productPublicId}.translations.ar`,
      message:
        "Arabic approval is stale because the English source changed. Re-approve Arabic before publishing.",
    });
  }

  return issues;
}
