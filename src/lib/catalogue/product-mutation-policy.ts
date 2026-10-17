import { and, eq } from "drizzle-orm";

import { catalogueProducts } from "@/db/schema";
import type { TenantDbExecutor } from "@/lib/tenant/context";

export const CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE = "product_archived";

export const CATALOGUE_PRODUCT_ARCHIVED_MESSAGE =
  "Archived products cannot be edited.";

export function isArchivedCatalogueProduct(status: string): boolean {
  return status === "archived";
}

export class CatalogueProductMutationGuardError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly code?: string;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    code?: string,
  ) {
    super(message);
    this.name = "CatalogueProductMutationGuardError";
    this.statusCode = statusCode;
    this.field = field;
    this.code = code;
  }
}

export function isCatalogueProductMutationGuardError(
  error: unknown,
): error is CatalogueProductMutationGuardError {
  return error instanceof CatalogueProductMutationGuardError;
}

export type CatalogueProductMutationLoadOptions = {
  /** When false, skip row lock (e.g. worker ingest paths that cannot take product row locks). */
  rowLock?: boolean;
};

export async function loadCatalogueProductForMutationInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  productPublicId: string,
  options: CatalogueProductMutationLoadOptions = {},
) {
  const rowLock = options.rowLock !== false;
  const baseQuery = tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);

  const [product] = await (rowLock ? baseQuery.for("update") : baseQuery);

  if (!product) {
    throw new CatalogueProductMutationGuardError("Product not found.", 404);
  }

  if (isArchivedCatalogueProduct(product.status)) {
    throw new CatalogueProductMutationGuardError(
      CATALOGUE_PRODUCT_ARCHIVED_MESSAGE,
      409,
      "status",
      CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
    );
  }

  return product;
}
