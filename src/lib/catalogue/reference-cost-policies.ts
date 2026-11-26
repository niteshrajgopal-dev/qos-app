import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueModifierOptionReferenceCostPolicies,
  catalogueVariantReferenceCostPolicies,
  tenants,
} from "@/db/schema";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import {
  BASIS_POINTS_PER_WHOLE,
  calendarDateInTimeZone,
  currencyMinorExponent,
  isCalendarDate,
  majorToMicrosExact,
  microsToMajorString,
  parseMicrosInteger,
  REFERENCE_COST_TAX_BASES,
  REFERENCE_COST_UNITS,
  type ReferenceCostMethod,
  type ReferenceCostTaxBasis,
  type ReferenceCostUnit,
  type SellingPriceTaxBasis,
} from "@/lib/catalogue/selling-tax-cost";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import type { ActiveStaffMembership } from "@/lib/staff/auth";

/* QOS-215 reference-cost policies for sellable variants and modifier
   options. Policies are append-only and dated (QOS-160 plan §4.1): a new
   policy closes the current one by setting effective_to and is inserted as
   the next revision; historical amounts are never rewritten. This module
   records the policy and explains it. Recipe-derived amounts are computed by
   the recipe engine (QOS-199, src/lib/recipes/costing.ts) and passed in; this
   module never values inventory, files tax or touches checkout pricing. */

export type SellableKind = "variant" | "modifier_option";

type VariantPolicyRow = typeof catalogueVariantReferenceCostPolicies.$inferSelect;
type OptionPolicyRow = typeof catalogueModifierOptionReferenceCostPolicies.$inferSelect;
export type ReferenceCostPolicyRow = Omit<VariantPolicyRow, "variantId"> | Omit<OptionPolicyRow, "modifierOptionId">;

// ---------------------------------------------------------------------------
// Pure results

/** Why a recipe-derived amount has no number. computed_per_configuration: an option's amount depends on the configuration. */
export type RecipeDerivedReason =
  | "computed_per_configuration"
  | "recipe_no_link"
  | "recipe_no_version"
  | "recipe_incomplete"
  | "recipe_unresolved";

/**
 * QOS-199: the recipe engine's base-configuration result for one variant
 * (lines only, today's reference costs, one sale), passed in by the caller.
 */
export type RecipeDerivedOutcome =
  | {
      status: "computed";
      amountMicros: bigint;
      rounding: "none" | "half_up_micros";
      currency: string;
      taxBasis: ReferenceCostTaxBasis | "mixed";
      /** The recipe and version used; null for a direct-stock link. */
      recipe: { publicId: string; nameEn: string; nameAr: string | null } | null;
      versionNumber: number | null;
    }
  | { status: "unavailable"; reason: Exclude<RecipeDerivedReason, "computed_per_configuration"> };

export type ResolvedReferenceCost =
  | {
      status: "manual_reference";
      amountMicros: bigint;
      currency: string;
      unit: ReferenceCostUnit | null;
      taxBasis: Exclude<ReferenceCostTaxBasis, "unconfirmed">;
      effectiveFrom: string;
      policyPublicId: string;
      revision: number;
    }
  | {
      status: "recipe_derived_reference";
      amount: "unavailable";
      reason: RecipeDerivedReason;
      unit: ReferenceCostUnit | null;
      taxBasis: ReferenceCostTaxBasis | null;
      effectiveFrom: string | null;
      policyPublicId: string;
      revision: number;
    }
  | {
      /** QOS-199: computed from the linked recipe's base lines for one sale. */
      status: "recipe_derived_computed";
      amountMicros: bigint;
      rounding: "none" | "half_up_micros";
      currency: string;
      unit: "each";
      taxBasis: ReferenceCostTaxBasis | "mixed";
      /** The recipe and version used; null for a direct-stock link. */
      recipe: { publicId: string; nameEn: string; nameAr: string | null } | null;
      versionNumber: number | null;
      effectiveFrom: string | null;
      policyPublicId: string;
      revision: number;
    }
  | {
      status: "unavailable";
      reason:
        | "no_policy"
        | "unconfirmed_cost_tax_basis"
        | "missing_cost_tax_basis"
        | "missing_currency"
        | "missing_amount"
        | "missing_effective_date";
      policyPublicId?: string;
      revision?: number;
    };

/**
 * Resolves the current policy row (effective_to IS NULL) into a stable result.
 * A recipe-derived policy takes its amount from `recipe` when the caller
 * computed one (variants); without it (modifier options) the amount depends
 * on the configuration and is computed in the recipe preview.
 */
export function resolveReferenceCost(
  policy: ReferenceCostPolicyRow | null | undefined,
  recipe?: RecipeDerivedOutcome,
): ResolvedReferenceCost {
  if (!policy) {
    return { status: "unavailable", reason: "no_policy" };
  }
  const ids = { policyPublicId: policy.publicId, revision: policy.revision };

  if (policy.method === "recipe_derived") {
    if (recipe?.status === "computed") {
      return {
        status: "recipe_derived_computed",
        amountMicros: recipe.amountMicros,
        rounding: recipe.rounding,
        currency: recipe.currency,
        unit: "each",
        taxBasis: recipe.taxBasis,
        recipe: recipe.recipe,
        versionNumber: recipe.versionNumber,
        effectiveFrom: policy.effectiveFrom ?? null,
        ...ids,
      };
    }
    return {
      status: "recipe_derived_reference",
      amount: "unavailable",
      reason: recipe?.status === "unavailable" ? recipe.reason : "computed_per_configuration",
      unit: policy.unit ?? null,
      taxBasis: policy.taxBasis ?? null,
      effectiveFrom: policy.effectiveFrom ?? null,
      ...ids,
    };
  }

  if (policy.amountMicros == null) {
    return { status: "unavailable", reason: "missing_amount", ...ids };
  }
  const currency = policy.currency?.trim();
  if (!currency) {
    return { status: "unavailable", reason: "missing_currency", ...ids };
  }
  if (!policy.effectiveFrom) {
    return { status: "unavailable", reason: "missing_effective_date", ...ids };
  }
  if (policy.taxBasis == null) {
    return { status: "unavailable", reason: "missing_cost_tax_basis", ...ids };
  }
  if (policy.taxBasis === "unconfirmed") {
    return { status: "unavailable", reason: "unconfirmed_cost_tax_basis", ...ids };
  }

  return {
    status: "manual_reference",
    amountMicros: policy.amountMicros,
    currency,
    unit: policy.unit ?? null,
    taxBasis: policy.taxBasis,
    effectiveFrom: policy.effectiveFrom,
    ...ids,
  };
}

export type ModifierEffectType = "ADD" | "REMOVE" | "REPLACE";

export type ModifierCostAdjustmentExplanation =
  | {
      /** ADD: the base and the option stay separate results; nothing is summed. */
      status: "separate";
      effectType: "ADD";
      base: ResolvedReferenceCost;
      option: ResolvedReferenceCost;
    }
  | {
      status: "unresolved_attribution";
      effectType: "REMOVE" | "REPLACE";
      reason: "cannot_net_manual_base";
      base: ResolvedReferenceCost;
      option: ResolvedReferenceCost;
    }
  | {
      /** The base is recipe-derived: the recipe engine nets REMOVE/REPLACE against recipe lines per configuration. */
      status: "recipe_configuration";
      effectType: "REMOVE" | "REPLACE";
      reason: "computed_per_configuration";
      base: ResolvedReferenceCost;
      option: ResolvedReferenceCost;
    }
  | {
      status: "unavailable";
      effectType: "REMOVE" | "REPLACE";
      reason: "base_cost_unavailable";
      base: ResolvedReferenceCost;
      option: ResolvedReferenceCost;
    };

/**
 * Explains how an option's cost relates to its base sellable. It never
 * invents a complete net cost: ADD keeps both results apart, and
 * REMOVE/REPLACE against a manual base cost is unresolved because a manual
 * amount has no ingredient lines to take something out of.
 */
export function explainModifierCostAdjustment(input: {
  base: ResolvedReferenceCost;
  option: ResolvedReferenceCost;
  effectType: ModifierEffectType;
}): ModifierCostAdjustmentExplanation {
  const { base, option, effectType } = input;
  if (effectType === "ADD") {
    return { status: "separate", effectType, base, option };
  }
  if (base.status === "manual_reference") {
    return { status: "unresolved_attribution", effectType, reason: "cannot_net_manual_base", base, option };
  }
  if (base.status === "recipe_derived_reference" || base.status === "recipe_derived_computed") {
    return { status: "recipe_configuration", effectType, reason: "computed_per_configuration", base, option };
  }
  return { status: "unavailable", effectType, reason: "base_cost_unavailable", base, option };
}

export type ReferenceMarginUnavailableReason =
  | "missing_price"
  | "missing_selling_tax_basis"
  | "unconfirmed_selling_tax_basis"
  | "missing_tax_rate"
  | "cost_unavailable"
  | "recipe_derived_cost_not_computed"
  | "recipe_no_link"
  | "recipe_no_version"
  | "recipe_incomplete"
  | "recipe_unresolved"
  | "unconfirmed_cost_tax_basis"
  | "mixed_cost_tax_basis"
  | "currency_mismatch"
  | "cost_unit_not_each";

export type ReferenceMarginResult =
  | {
      status: "available";
      /** Basis both amounts were compared on. */
      basis: "net" | "gross";
      currency: string;
      priceMicros: bigint;
      costMicros: bigint;
      /** priceMicros − costMicros; may be negative when cost exceeds price. */
      marginMicros: bigint;
      rounding: "none" | "half_up_micros";
    }
  | { status: "unavailable"; reason: ReferenceMarginUnavailableReason };

export type SellingPriceForMargin = {
  amountMinor: number | null;
  currency: string | null;
  priceTaxBasis: SellingPriceTaxBasis | null;
  taxRateBasisPoints: number | null;
};

const MICROS_PER_MINOR_2DP = BigInt(10_000);

function divideHalfUp(numerator: bigint, denominator: bigint) {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

/**
 * Brings a 2-decimal selling price onto the cost's tax basis with at most one
 * step (QOS-199 shares this with the configuration margin):
 * exclusive/net and inclusive/gross compare as recorded; inclusive/net
 * divides by (10_000 + bps) / 10_000 once, rounded half-up to whole micros;
 * exclusive/gross multiplies exactly. A missing rate when the bases differ is
 * refused, never assumed.
 */
export function compareOnBasis(
  price: { amountMinor: number; isGross: boolean; taxRateBasisPoints: number | null },
  costIsGross: boolean,
): { status: "ok"; priceMicros: bigint; rounding: "none" | "half_up_micros" } | { status: "missing_tax_rate" } {
  const recordedPriceMicros = BigInt(price.amountMinor) * MICROS_PER_MINOR_2DP;
  if (price.isGross === costIsGross) {
    return { status: "ok", priceMicros: recordedPriceMicros, rounding: "none" };
  }
  if (price.taxRateBasisPoints == null) {
    return { status: "missing_tax_rate" };
  }
  const rate = BigInt(price.taxRateBasisPoints);
  if (price.isGross) {
    const denominator = BASIS_POINTS_PER_WHOLE + rate;
    const numerator = recordedPriceMicros * BASIS_POINTS_PER_WHOLE;
    return {
      status: "ok",
      priceMicros: divideHalfUp(numerator, denominator),
      rounding: numerator % denominator === BigInt(0) ? "none" : "half_up_micros",
    };
  }
  // price_minor × 10_000 micros × (10_000 + bps) / 10_000 = price_minor × (10_000 + bps): exact.
  return { status: "ok", priceMicros: BigInt(price.amountMinor) * (BASIS_POINTS_PER_WHOLE + rate), rounding: "none" };
}

/**
 * Reference margin for one sellable: selling price minus manual reference
 * cost, in micros, after at most one tax-normalization step.
 *
 * - price exclusive + cost NET, or price inclusive + cost GROSS: compared as
 *   recorded; no rate needed, no rounding.
 * - price inclusive + cost NET: the price is brought to NET with the
 *   variant's own rate: price × 10_000 / (10_000 + bps), rounded once,
 *   half-up, to whole micros. This is the only rounding.
 * - price exclusive + cost GROSS: the price is brought to GROSS:
 *   price × (10_000 + bps) / 10_000, which is exact in micros.
 *
 * Anything missing, unconfirmed, recipe-derived (no engine yet) or in
 * another currency or unit makes the margin unavailable. It never returns
 * 0 or a 100% margin for missing data and never assumes the Phase 1 test
 * rate. Selling prices are 2-decimal currencies today (AED); a currency with
 * another exponent is reported as a currency mismatch rather than guessed.
 */
export function referenceMargin(price: SellingPriceForMargin, cost: ResolvedReferenceCost): ReferenceMarginResult {
  if (price.amountMinor == null || !price.currency) {
    return { status: "unavailable", reason: "missing_price" };
  }
  if (price.priceTaxBasis == null) {
    return { status: "unavailable", reason: "missing_selling_tax_basis" };
  }
  if (price.priceTaxBasis === "unconfirmed") {
    return { status: "unavailable", reason: "unconfirmed_selling_tax_basis" };
  }
  if (cost.status === "recipe_derived_reference") {
    return {
      status: "unavailable",
      reason: cost.reason === "computed_per_configuration" ? "recipe_derived_cost_not_computed" : cost.reason,
    };
  }
  if (cost.status === "recipe_derived_computed") {
    // An ingredient basis that is unconfirmed or mixes net and gross is never compared with a price.
    if (cost.taxBasis === "unconfirmed") {
      return { status: "unavailable", reason: "unconfirmed_cost_tax_basis" };
    }
    if (cost.taxBasis === "mixed") {
      return { status: "unavailable", reason: "mixed_cost_tax_basis" };
    }
  } else if (cost.status !== "manual_reference") {
    return { status: "unavailable", reason: "cost_unavailable" };
  }
  if (cost.currency !== price.currency.trim()) {
    return { status: "unavailable", reason: "currency_mismatch" };
  }
  if (currencyMinorExponent(cost.currency) !== 2) {
    return { status: "unavailable", reason: "currency_mismatch" };
  }
  if (cost.unit !== "each") {
    return { status: "unavailable", reason: "cost_unit_not_each" };
  }

  const compared = compareOnBasis(
    { amountMinor: price.amountMinor, isGross: price.priceTaxBasis === "inclusive", taxRateBasisPoints: price.taxRateBasisPoints },
    cost.taxBasis === "gross",
  );
  if (compared.status !== "ok") {
    return { status: "unavailable", reason: "missing_tax_rate" };
  }
  const { priceMicros, rounding } = compared;
  const costIsGross = cost.taxBasis === "gross";

  return {
    status: "available",
    basis: costIsGross ? "gross" : "net",
    currency: cost.currency,
    priceMicros,
    costMicros: cost.amountMicros,
    marginMicros: priceMicros - cost.amountMicros,
    rounding,
  };
}

// ---------------------------------------------------------------------------
// JSON views (bigint → exact strings)

export type ReferenceCostPolicyView = {
  publicId: string;
  method: ReferenceCostMethod;
  /** Integer micros as a decimal string; null when not recorded (recipe-derived). */
  amountMicros: string | null;
  /** Exact major-unit text for amountMicros ("2.5", "0"). */
  amountMajor: string | null;
  currency: string | null;
  unit: ReferenceCostUnit | null;
  taxBasis: ReferenceCostTaxBasis | null;
  effectiveFrom: string | null;
  source: string | null;
  sourceReference: string | null;
  revision: number;
  provenance: string | null;
};

export type ResolvedReferenceCostView =
  | (Omit<Extract<ResolvedReferenceCost, { status: "manual_reference" }>, "amountMicros"> & {
      amountMicros: string;
    })
  | (Omit<Extract<ResolvedReferenceCost, { status: "recipe_derived_computed" }>, "amountMicros"> & {
      amountMicros: string;
      /** Exact major-unit text for amountMicros. */
      amountMajor: string;
    })
  | Exclude<ResolvedReferenceCost, { status: "manual_reference" | "recipe_derived_computed" }>;

export type ReferenceMarginView =
  | (Omit<Extract<ReferenceMarginResult, { status: "available" }>, "priceMicros" | "costMicros" | "marginMicros"> & {
      priceMicros: string;
      costMicros: string;
      marginMicros: string;
      marginMajor: string;
    })
  | Extract<ReferenceMarginResult, { status: "unavailable" }>;

export type SellableReferenceCostView = {
  policy: ReferenceCostPolicyView | null;
  resolution: ResolvedReferenceCostView;
};

export function toReferenceCostPolicyView(row: ReferenceCostPolicyRow | null | undefined): ReferenceCostPolicyView | null {
  if (!row) {
    return null;
  }
  return {
    publicId: row.publicId,
    method: row.method,
    amountMicros: row.amountMicros == null ? null : row.amountMicros.toString(),
    amountMajor: row.amountMicros == null ? null : microsToMajorString(row.amountMicros),
    currency: row.currency?.trim() ?? null,
    unit: row.unit ?? null,
    taxBasis: row.taxBasis ?? null,
    effectiveFrom: row.effectiveFrom ?? null,
    source: row.source ?? null,
    sourceReference: row.sourceReference ?? null,
    revision: row.revision,
    provenance: row.provenance ?? null,
  };
}

export function toResolvedReferenceCostView(resolved: ResolvedReferenceCost): ResolvedReferenceCostView {
  if (resolved.status === "manual_reference") {
    return { ...resolved, amountMicros: resolved.amountMicros.toString() };
  }
  if (resolved.status === "recipe_derived_computed") {
    return { ...resolved, amountMicros: resolved.amountMicros.toString(), amountMajor: microsToMajorString(resolved.amountMicros) };
  }
  return resolved;
}

export function toReferenceMarginView(result: ReferenceMarginResult): ReferenceMarginView {
  if (result.status !== "available") {
    return result;
  }
  return {
    ...result,
    priceMicros: result.priceMicros.toString(),
    costMicros: result.costMicros.toString(),
    marginMicros: result.marginMicros.toString(),
    marginMajor: microsToMajorString(result.marginMicros, 2),
  };
}

export function toSellableReferenceCostView(
  row: ReferenceCostPolicyRow | null | undefined,
  recipe?: RecipeDerivedOutcome,
): SellableReferenceCostView {
  return {
    policy: toReferenceCostPolicyView(row),
    resolution: toResolvedReferenceCostView(resolveReferenceCost(row, recipe)),
  };
}

// ---------------------------------------------------------------------------
// Requests

export type CostPolicyOperationInput =
  | {
      operation: "set_manual";
      /** Major-unit decimal string, up to six decimals ("2.5", "0"). Exactly one of amount / amountMicros. */
      amount?: string;
      /** Integer micros (string of digits or a safe integer). */
      amountMicros?: string | number;
      currency: string;
      unit?: ReferenceCostUnit | null;
      taxBasis?: ReferenceCostTaxBasis | null;
      effectiveFrom: string;
      source?: string | null;
      sourceReference?: string | null;
    }
  | {
      operation: "change_to_recipe_derived";
      unit?: ReferenceCostUnit | null;
      taxBasis?: ReferenceCostTaxBasis | null;
      effectiveFrom?: string | null;
      source?: string | null;
      sourceReference?: string | null;
    }
  | { operation: "clear" };

export type ValidatedCostPolicyOperation =
  | {
      operation: "set_manual";
      amountMicros: bigint;
      currency: string;
      unit: ReferenceCostUnit | null;
      taxBasis: ReferenceCostTaxBasis | null;
      effectiveFrom: string;
      source: string | null;
      sourceReference: string | null;
    }
  | {
      operation: "change_to_recipe_derived";
      unit: ReferenceCostUnit | null;
      taxBasis: ReferenceCostTaxBasis | null;
      effectiveFrom: string | null;
      source: string | null;
      sourceReference: string | null;
    }
  | { operation: "clear" };

const FIELD = "costPolicy";

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new CatalogueValidationError(`${field} must be text.`, `${FIELD}.${field}`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new CatalogueValidationError(`${field} must be at most ${maxLength} characters.`, `${FIELD}.${field}`);
  }
  return trimmed || null;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new CatalogueValidationError(`${field} must be one of ${allowed.join(", ")}.`, `${FIELD}.${field}`);
  }
  return value as T;
}

/**
 * Validates an explicit cost-policy request. `undefined` means "no change"
 * and returns undefined: omitting costPolicy never clears or replaces the
 * current policy, and a blank amount is never read as recipe-derived.
 */
export function validateCostPolicyOperation(input: unknown): ValidatedCostPolicyOperation | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogueValidationError("costPolicy must be an object with an operation.", FIELD);
  }
  const body = input as Record<string, unknown>;

  if (body.operation === "clear") {
    return { operation: "clear" };
  }

  const unit = optionalEnum(body.unit, REFERENCE_COST_UNITS, "unit");
  const taxBasis = optionalEnum(body.taxBasis, REFERENCE_COST_TAX_BASES, "taxBasis");
  const source = optionalText(body.source, "source", 200);
  const sourceReference = optionalText(body.sourceReference, "sourceReference", 500);

  if (body.operation === "change_to_recipe_derived") {
    if (body.amount !== undefined || body.amountMicros !== undefined) {
      throw new CatalogueValidationError(
        "A recipe-derived policy has no amount; QOS computes it from the linked recipe.",
        `${FIELD}.amount`,
      );
    }
    if (body.effectiveFrom != null && !isCalendarDate(body.effectiveFrom)) {
      throw new CatalogueValidationError("effectiveFrom must be a YYYY-MM-DD date.", `${FIELD}.effectiveFrom`);
    }
    return {
      operation: "change_to_recipe_derived",
      unit,
      taxBasis,
      effectiveFrom: (body.effectiveFrom as string | null | undefined) ?? null,
      source,
      sourceReference,
    };
  }

  if (body.operation !== "set_manual") {
    throw new CatalogueValidationError(
      "costPolicy.operation must be set_manual, change_to_recipe_derived or clear.",
      `${FIELD}.operation`,
    );
  }

  const hasAmount = body.amount !== undefined && body.amount !== null;
  const hasMicros = body.amountMicros !== undefined && body.amountMicros !== null;
  if (hasAmount === hasMicros) {
    throw new CatalogueValidationError(
      "A manual cost needs exactly one of amount (major units) or amountMicros. 0 is a valid known-zero cost.",
      `${FIELD}.amount`,
    );
  }

  let amountMicros: bigint;
  if (hasAmount) {
    if (typeof body.amount !== "string") {
      throw new CatalogueValidationError("amount must be a decimal string such as \"2.50\".", `${FIELD}.amount`);
    }
    const parsed = majorToMicrosExact(body.amount);
    if (parsed.status === "blank") {
      throw new CatalogueValidationError(
        "A manual cost needs an amount. Use 0 for a known zero cost, or choose recipe-derived.",
        `${FIELD}.amount`,
      );
    }
    if (parsed.status === "invalid") {
      throw new CatalogueValidationError(
        parsed.reason === "too_precise"
          ? "Cost amounts support at most six decimal places."
          : "amount must be a non-negative decimal number.",
        `${FIELD}.amount`,
      );
    }
    amountMicros = parsed.value;
  } else {
    const parsed = parseMicrosInteger(body.amountMicros);
    if (parsed == null) {
      throw new CatalogueValidationError("amountMicros must be a non-negative integer.", `${FIELD}.amountMicros`);
    }
    amountMicros = parsed;
  }

  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CatalogueValidationError("A manual cost needs a 3-letter currency.", `${FIELD}.currency`);
  }
  if (!isCalendarDate(body.effectiveFrom)) {
    throw new CatalogueValidationError("A manual cost needs an effectiveFrom YYYY-MM-DD date.", `${FIELD}.effectiveFrom`);
  }

  return {
    operation: "set_manual",
    amountMicros,
    currency,
    unit,
    taxBasis,
    effectiveFrom: body.effectiveFrom,
    source,
    sourceReference,
  };
}

// ---------------------------------------------------------------------------
// Persistence

export class ReferenceCostPolicyError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "ReferenceCostPolicyError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

function generatePolicyPublicId(kind: SellableKind) {
  const prefix = kind === "variant" ? "vrc" : "orc";
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Current policy rows (effective_to IS NULL) keyed by sellable id. */
export async function loadCurrentCostPoliciesInTx(
  tx: DbClient,
  tenantId: string,
  kind: SellableKind,
  sellableIds: string[],
): Promise<Map<string, ReferenceCostPolicyRow>> {
  const byId = new Map<string, ReferenceCostPolicyRow>();
  if (sellableIds.length === 0) {
    return byId;
  }
  if (kind === "variant") {
    const table = catalogueVariantReferenceCostPolicies;
    const rows = await tx
      .select()
      .from(table)
      .where(and(eq(table.tenantId, tenantId), inArray(table.variantId, sellableIds), isNull(table.effectiveTo)));
    for (const row of rows) byId.set(row.variantId, row);
  } else {
    const table = catalogueModifierOptionReferenceCostPolicies;
    const rows = await tx
      .select()
      .from(table)
      .where(
        and(eq(table.tenantId, tenantId), inArray(table.modifierOptionId, sellableIds), isNull(table.effectiveTo)),
      );
    for (const row of rows) byId.set(row.modifierOptionId, row);
  }
  return byId;
}

/** Full history for one sellable, newest revision first. Read-only; history is never rewritten. */
export async function listCostPolicyHistoryInTx(
  tx: DbClient,
  tenantId: string,
  kind: SellableKind,
  sellableId: string,
): Promise<ReferenceCostPolicyRow[]> {
  if (kind === "variant") {
    const table = catalogueVariantReferenceCostPolicies;
    const rows = await tx
      .select()
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.variantId, sellableId)))
      .orderBy(desc(table.revision));
    return rows;
  }
  const table = catalogueModifierOptionReferenceCostPolicies;
  const rows = await tx
    .select()
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.modifierOptionId, sellableId)))
    .orderBy(desc(table.revision));
  return rows;
}

async function tenantToday(tx: DbClient, tenantId: string, now: Date) {
  const [tenant] = await tx
    .select({ defaultTimezone: tenants.defaultTimezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return calendarDateInTimeZone(now, tenant?.defaultTimezone ?? "UTC");
}

async function nextRevision(tx: DbClient, tenantId: string, kind: SellableKind, sellableId: string) {
  if (kind === "variant") {
    const table = catalogueVariantReferenceCostPolicies;
    const [row] = await tx
      .select({ value: max(table.revision) })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.variantId, sellableId)));
    return (row?.value ?? 0) + 1;
  }
  const table = catalogueModifierOptionReferenceCostPolicies;
  const [row] = await tx
    .select({ value: max(table.revision) })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.modifierOptionId, sellableId)));
  return (row?.value ?? 0) + 1;
}

async function closePolicy(tx: DbClient, kind: SellableKind, policyId: string, effectiveTo: string) {
  // Only effective_to changes; qos_app has no UPDATE grant on any other column.
  const table = kind === "variant" ? catalogueVariantReferenceCostPolicies : catalogueModifierOptionReferenceCostPolicies;
  const closed = await tx
    .update(table)
    .set({ effectiveTo })
    .where(and(eq(table.id, policyId), isNull(table.effectiveTo)))
    .returning({ id: table.id });
  if (closed.length !== 1) {
    throw new ReferenceCostPolicyError("The cost policy was changed elsewhere. Reload and try again.", 409, FIELD);
  }
}

function auditPolicy(row: ReferenceCostPolicyRow | null) {
  if (!row) {
    return null;
  }
  return {
    policyPublicId: row.publicId,
    method: row.method,
    amountMicros: row.amountMicros == null ? null : row.amountMicros.toString(),
    currency: row.currency?.trim() ?? null,
    unit: row.unit,
    taxBasis: row.taxBasis,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    revision: row.revision,
  };
}

export type ApplyCostPolicyInput = {
  tenantId: string;
  kind: SellableKind;
  sellableId: string;
  sellablePublicId: string;
  operation: ValidatedCostPolicyOperation;
  membership: ActiveStaffMembership;
  actorSubject: string;
  provenance: "operator_entered" | "imported";
  /** Version stamped on the audit event (product or modifier group version after the write). */
  entityVersion: number;
  now?: Date;
};

export type ApplyCostPolicyResult = {
  changed: boolean;
  current: ReferenceCostPolicyRow | null;
};

/**
 * Applies one explicit cost-policy operation inside the caller's tenant
 * transaction and audits it.
 *
 * - set_manual inserts the next revision as the current row and closes the
 *   previous current row with effective_to = the new effective_from.
 * - change_to_recipe_derived does the same with a recipe-derived row (no
 *   amount); it is how a manual override stops being effective.
 * - clear closes the current row with no successor, so the cost becomes
 *   unavailable. There is no product-level store to inherit from.
 */
export async function applyCostPolicyOperationInTx(
  tx: DbClient,
  input: ApplyCostPolicyInput,
): Promise<ApplyCostPolicyResult> {
  const { tenantId, kind, sellableId, operation } = input;
  const now = input.now ?? new Date();
  const today = await tenantToday(tx, tenantId, now);
  const current = (await loadCurrentCostPoliciesInTx(tx, tenantId, kind, [sellableId])).get(sellableId) ?? null;

  const entityType = kind === "variant" ? "catalogue_variant" : "catalogue_modifier_option";
  const audit = async (action: string, after: ReferenceCostPolicyRow | null) => {
    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: input.actorSubject,
      actorClass: auditActorClassFromStaffRole(input.membership.role),
      action,
      entityType,
      entityPublicId: input.sellablePublicId,
      entityVersion: input.entityVersion,
      changeSummary: {
        before: auditPolicy(current),
        after: auditPolicy(after),
        provenance: input.provenance,
      },
    });
  };

  if (operation.operation === "clear") {
    if (!current) {
      return { changed: false, current: null };
    }
    const effectiveTo = current.effectiveFrom && current.effectiveFrom > today ? current.effectiveFrom : today;
    await closePolicy(tx, kind, current.id, effectiveTo);
    await audit("catalogue.reference_cost_policy.clear", null);
    return { changed: true, current: null };
  }

  const effectiveFrom = operation.effectiveFrom ?? today;
  if (current?.effectiveFrom && effectiveFrom < current.effectiveFrom) {
    throw new ReferenceCostPolicyError(
      `effectiveFrom cannot be earlier than the current policy's effective date (${current.effectiveFrom}). History is not rewritten.`,
      400,
      `${FIELD}.effectiveFrom`,
    );
  }

  const values = {
    tenantId,
    publicId: generatePolicyPublicId(kind),
    method: (operation.operation === "set_manual" ? "manual" : "recipe_derived") as ReferenceCostMethod,
    amountMicros: operation.operation === "set_manual" ? operation.amountMicros : null,
    currency: operation.operation === "set_manual" ? operation.currency : null,
    unit: operation.unit,
    taxBasis: operation.taxBasis,
    effectiveFrom,
    effectiveTo: null,
    source: operation.source,
    sourceReference: operation.sourceReference,
    revision: await nextRevision(tx, tenantId, kind, sellableId),
    provenance: input.provenance,
    createdBySubject: input.actorSubject,
  };

  if (current) {
    await closePolicy(tx, kind, current.id, effectiveFrom);
  }

  let inserted: ReferenceCostPolicyRow;
  if (kind === "variant") {
    const [row] = await tx
      .insert(catalogueVariantReferenceCostPolicies)
      .values({ ...values, variantId: sellableId })
      .returning();
    inserted = row!;
  } else {
    const [row] = await tx
      .insert(catalogueModifierOptionReferenceCostPolicies)
      .values({ ...values, modifierOptionId: sellableId })
      .returning();
    inserted = row!;
  }

  await audit(
    operation.operation === "set_manual"
      ? "catalogue.reference_cost_policy.set_manual"
      : "catalogue.reference_cost_policy.change_to_recipe_derived",
    inserted,
  );
  return { changed: true, current: inserted };
}
