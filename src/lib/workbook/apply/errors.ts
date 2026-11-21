import { CatalogueCategoryError } from "@/lib/catalogue/categories";
import { LocationPriceOverrideError } from "@/lib/catalogue/location-price-overrides";
import { MenuError } from "@/lib/catalogue/menus";
import { MenuValidationError } from "@/lib/catalogue/menus.validation";
import { CatalogueModifierError } from "@/lib/catalogue/modifiers";
import { CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE, CatalogueProductMutationGuardError } from "@/lib/catalogue/product-mutation-policy";
import { CatalogueProductError } from "@/lib/catalogue/products";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import { CatalogueVariantError } from "@/lib/catalogue/variants";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import type { ApplyFailure, ApplyFailureCode } from "@/lib/workbook/apply/model";
import type { RowRef } from "@/lib/workbook/validation/model";

/* Apply errors (QOS-217). `WorkbookApplyError` answers the route with a
   stable code; `ApplyUnitError` fails one unit with a per-row code. Service
   errors are mapped by class and status, never by message text, and nothing
   unexpected leaks internal detail. */

export type WorkbookApplyErrorCode =
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "apply_body_invalid"
  | "apply_requires_administrator"
  | "plan_not_found"
  | "plan_hash_mismatch"
  | "plan_stale"
  | "apply_in_progress"
  | "plan_applied"
  | "plan_rereview_required"
  | "review_incomplete";

export class WorkbookApplyError extends Error {
  readonly code: WorkbookApplyErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;

  constructor(code: WorkbookApplyErrorCode, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkbookApplyError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** A unit refused by the engine itself (dependency, revision, ownership, capability). */
export class ApplyUnitError extends Error {
  readonly failure: ApplyFailure;

  constructor(code: ApplyFailureCode, message: string, extra: { field?: string; reason?: string; responsible?: RowRef } = {}) {
    super(message);
    this.name = "ApplyUnitError";
    this.failure = { code, message, ...extra };
  }
}

type ServiceError = Error & { statusCode?: number; field?: string; code?: string };

const SERVICE_ERRORS = [
  CatalogueProductError,
  CatalogueVariantError,
  CatalogueCategoryError,
  CatalogueModifierError,
  MenuError,
  LocationPriceOverrideError,
  CatalogueProductMutationGuardError,
];

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function withField(failure: ApplyFailure, field: string | undefined): ApplyFailure {
  return field ? { ...failure, field } : failure;
}

/** A stable per-row failure for anything a unit threw. */
export function describeApplyFailure(error: unknown): ApplyFailure {
  if (error instanceof ApplyUnitError) return error.failure;
  if (error instanceof StaffAuthorizationError) {
    return { code: "forbidden", message: error.message };
  }
  if (error instanceof CatalogueValidationError || error instanceof MenuValidationError) {
    return withField({ code: "service_validation", message: error.message }, error.field);
  }
  if (SERVICE_ERRORS.some((type) => error instanceof type)) {
    const service = error as ServiceError;
    const status = service.statusCode ?? 400;
    if (service.code === CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE) {
      return withField({ code: "archived_target", message: service.message }, service.field);
    }
    const code: ApplyFailureCode =
      status === 409 ? "conflict" : status === 404 ? "target_not_found" : status === 403 ? "forbidden" : status === 400 ? "service_validation" : "unexpected";
    return withField({ code, message: code === "unexpected" ? "The change could not be saved." : service.message }, service.field);
  }
  if (isUniqueViolation(error)) {
    return { code: "unique_violation", message: "A record with the same identifier already exists." };
  }
  return { code: "unexpected", message: "The change could not be saved." };
}
