import type { ValidatedCostPolicyOperation } from "@/lib/catalogue/reference-cost-policies";
import {
  convertFoodicsProductCost,
  isCalendarDate,
  majorToMicrosExact,
  parseBasisPointsCell,
  parseCostTaxBasisToken,
  parseSellingTaxBasisToken,
  parseSourceTaxPercent,
  REFERENCE_COST_UNITS,
  type ReferenceCostUnit,
  type SellingPriceTaxBasis,
} from "@/lib/catalogue/selling-tax-cost";

/* QOS-215 capability contract for selling tax and reference cost, consumed
   by workbook review (QOS-194) and apply (QOS-200). It says what QOS can
   store today, what must stay with a person for review, and what is
   deferred to another ticket. Storing a field never makes the operation
   behind it "supported": a recipe-derived policy is persistable, the
   recipe-derived amount is not. This module applies nothing. */

export type SellingTaxCostCapabilityStatus = "persistable" | "review_only" | "deferred";

export type SellingTaxCostCapability = {
  id: string;
  status: SellingTaxCostCapabilityStatus;
  description: string;
  /** Workbook columns involved, as `Sheet.column`. */
  columns: string[];
  /** Persistable: the existing service call QOS-200 should use. Deferred: the owning ticket. */
  target: string;
};

const VARIANT_COST_COLUMNS = [
  "cost_method",
  "reference_cost_amount",
  "cost_currency",
  "cost_unit",
  "cost_tax_basis",
  "cost_effective_date",
  "cost_source",
  "cost_source_reference",
];

export const SELLING_TAX_COST_CAPABILITIES = [
  {
    id: "variant_price_tax_basis",
    status: "persistable",
    description: "Selling-price tax basis (inclusive, exclusive or unconfirmed) on a variant.",
    columns: ["Variants.price_tax_basis"],
    target: "PATCH variants/{variant} priceTaxBasis (updateProductVariant)",
  },
  {
    id: "variant_tax_rate_basis_points",
    status: "persistable",
    description: "Exact selling-price tax rate in basis points on a variant; 0 is a real 0% rate.",
    columns: ["Variants.tax_rate_basis_points"],
    target: "PATCH variants/{variant} taxRateBasisPoints (updateProductVariant)",
  },
  {
    id: "variant_cost_policy_manual",
    status: "persistable",
    description: "Current manual reference-cost policy on a variant (amount, currency, unit, basis, date, source).",
    columns: VARIANT_COST_COLUMNS.map((column) => `Variants.${column}`),
    target: "PATCH variants/{variant} costPolicy.set_manual (updateProductVariant)",
  },
  {
    id: "variant_cost_policy_recipe_derived",
    status: "persistable",
    description: "Current recipe-derived reference-cost policy on a variant; the policy only, never an amount.",
    columns: ["Variants.cost_method"],
    target: "PATCH variants/{variant} costPolicy.change_to_recipe_derived (updateProductVariant)",
  },
  {
    id: "modifier_option_cost_policy_manual",
    status: "persistable",
    description: "Current manual reference-cost policy on a modifier option.",
    columns: VARIANT_COST_COLUMNS.map((column) => `Modifier Options.${column}`),
    target: "PATCH modifier-groups/{group}/options/{option} costPolicy.set_manual (updateModifierOption)",
  },
  {
    id: "modifier_option_cost_policy_recipe_derived",
    status: "persistable",
    description: "Current recipe-derived reference-cost policy on a modifier option; the policy only.",
    columns: ["Modifier Options.cost_method"],
    target: "PATCH modifier-groups/{group}/options/{option} costPolicy.change_to_recipe_derived (updateModifierOption)",
  },
  {
    id: "ambiguous_tax_rate",
    status: "review_only",
    description: "A source tax cell holding a bare number above 1 (5, 16): percent or basis points cannot be told apart.",
    columns: ["Foodics 2-Products tax %"],
    target: "Person confirms the rate; never guessed.",
  },
  {
    id: "unresolved_tax_value",
    status: "review_only",
    description: "Tax-group names and other non-numeric tax cells; the source text is kept and no rate is invented.",
    columns: ["Foodics 2-Products tax %", "Variants.tax_rate_basis_points"],
    target: "Person maps the value to a rate.",
  },
  {
    id: "unknown_tax_basis_token",
    status: "review_only",
    description: "A tax basis token other than inclusive/exclusive/unconfirmed/GROSS/NET; never defaulted.",
    columns: ["Variants.price_tax_basis", "Variants.cost_tax_basis", "Foodics 2-Products inclusive/exclusive"],
    target: "Person chooses the basis.",
  },
  {
    id: "unconfirmed_selling_tax_basis",
    status: "review_only",
    description: "Selling basis recorded as unconfirmed: the row saves; only reference margin stays unavailable (QOS-161 D6).",
    columns: ["Variants.price_tax_basis"],
    target: "Owner decision in QOS-161.",
  },
  {
    id: "unconfirmed_cost_tax_basis",
    status: "review_only",
    description: "Cost basis UNCONFIRMED or blank: the policy saves; reference cost and margin stay unavailable.",
    columns: ["Variants.cost_tax_basis", "Modifier Options.cost_tax_basis"],
    target: "Owner decision in QOS-161.",
  },
  {
    id: "unresolved_modifier_cost_attribution",
    status: "review_only",
    description: "REMOVE or REPLACE modifier effects against a manual base cost cannot be netted; reported, not invented.",
    columns: ["Modifier Effects.effect_type"],
    target: "explainModifierCostAdjustment → unresolved_attribution; QOS-199 resolves with recipes.",
  },
  {
    id: "foodics_blank_cost_recipe_derived",
    status: "review_only",
    description: "A blank Foodics Product Cost requests the recipe-derived method for the default variant, pending review.",
    columns: ["Foodics 2-Products Product Cost", "Foodics 4-Modifiers option cost"],
    target: "Person confirms change_to_recipe_derived; generic updates never infer it.",
  },
  {
    id: "recipe_derived_cost_amount",
    status: "deferred",
    description: "Computing the recipe-derived reference amount from ingredients.",
    columns: [],
    target: "QOS-199",
  },
  {
    id: "inventory_valuation",
    status: "deferred",
    description: "Posted stock valuation. Reference costs never overwrite it.",
    columns: [],
    target: "QOS-201 to QOS-204",
  },
  {
    id: "tax_filing",
    status: "deferred",
    description: "Tax returns and filing. Not part of reference pricing.",
    columns: [],
    target: "Out of Phase 2 scope",
  },
  {
    id: "checkout_tax",
    status: "deferred",
    description: "Checkout tax calculation stays on the Phase 1 synthetic test policy; variant tax is not wired into checkout.",
    columns: [],
    target: "Separate checkout decision",
  },
  {
    id: "type_of_tax",
    status: "deferred",
    description: "Foodics type_of_tax / tax group assignment.",
    columns: ["Foodics type_of_tax"],
    target: "Deferred by QOS-216",
  },
  {
    id: "workbook_apply",
    status: "deferred",
    description: "Applying reviewed workbook rows to the catalogue.",
    columns: [],
    target: "QOS-200",
  },
] as const satisfies readonly SellingTaxCostCapability[];

export type SellingTaxCostCapabilityId = (typeof SELLING_TAX_COST_CAPABILITIES)[number]["id"];

export function sellingTaxCostCapability(id: SellingTaxCostCapabilityId): SellingTaxCostCapability {
  return SELLING_TAX_COST_CAPABILITIES.find((capability) => capability.id === id)!;
}

// ---------------------------------------------------------------------------
// Review of one workbook row (stateless; nothing is applied)

/** Workbook apply of these persistable columns is QOS-200's, not this leaf. */
export const SELLING_TAX_COST_APPLY_OWNER = "QOS-200 apply";

/** The persistable tax or current-cost-policy column, or undefined for any other column. */
export function sellingTaxCostColumnCapability(sheet: string, column: string) {
  const id = `${sheet}.${column}`;
  return SELLING_TAX_COST_CAPABILITIES.find(
    (capability) => capability.status === "persistable" && (capability.columns as readonly string[]).includes(id),
  );
}

export type SellingTaxCostDiagnostic = {
  capability: SellingTaxCostCapabilityId;
  /** error: the cell cannot be stored as written. review: storable, but a person must look. */
  severity: "error" | "review";
  column: string;
  reason: string;
  sourceText?: string;
};

export type SellingTaxCostRowReview = {
  /** Only cells that were filled; blank update cells mean "unchanged". */
  tax: { priceTaxBasis?: SellingPriceTaxBasis; taxRateBasisPoints?: number };
  costPolicy?: Exclude<ValidatedCostPolicyOperation, { operation: "clear" }>;
  diagnostics: SellingTaxCostDiagnostic[];
};

function costPolicyFromCells(
  values: Record<string, string | undefined>,
  diagnostics: SellingTaxCostDiagnostic[],
): SellingTaxCostRowReview["costPolicy"] {
  const cell = (key: string) => (values[key] ?? "").trim();
  const method = cell("cost_method").toLowerCase();
  const anyCostCell = VARIANT_COST_COLUMNS.some((key) => cell(key));
  const error = (column: string, reason: string, sourceText?: string) =>
    diagnostics.push({
      capability: method === "recipe_derived" ? "variant_cost_policy_recipe_derived" : "variant_cost_policy_manual",
      severity: "error",
      column,
      reason,
      ...(sourceText ? { sourceText } : {}),
    });

  if (!method) {
    if (anyCostCell) {
      // A blank method is never read as recipe-derived.
      error("cost_method", "cost_fields_without_method");
    }
    return undefined;
  }
  if (method !== "manual" && method !== "recipe_derived") {
    error("cost_method", "unknown_cost_method", cell("cost_method"));
    return undefined;
  }

  const taxBasisResult = parseCostTaxBasisToken(cell("cost_tax_basis"));
  let taxBasis: "net" | "gross" | "unconfirmed" | null = null;
  if (taxBasisResult.status === "unknown") {
    diagnostics.push({
      capability: "unknown_tax_basis_token",
      severity: "error",
      column: "cost_tax_basis",
      reason: "unknown_cost_tax_basis",
      sourceText: taxBasisResult.sourceText,
    });
    return undefined;
  }
  if (taxBasisResult.status === "ok") {
    taxBasis = taxBasisResult.basis;
  }
  if (taxBasis == null || taxBasis === "unconfirmed") {
    diagnostics.push({
      capability: "unconfirmed_cost_tax_basis",
      severity: "review",
      column: "cost_tax_basis",
      reason: taxBasis == null ? "cost_tax_basis_blank" : "cost_tax_basis_unconfirmed",
    });
  }

  const unitText = cell("cost_unit").toLowerCase();
  if (unitText && !(REFERENCE_COST_UNITS as readonly string[]).includes(unitText)) {
    error("cost_unit", "unknown_cost_unit", cell("cost_unit"));
    return undefined;
  }
  const unit = (unitText || null) as ReferenceCostUnit | null;
  const effectiveDate = cell("cost_effective_date");
  if (effectiveDate && !isCalendarDate(effectiveDate)) {
    error("cost_effective_date", "not_a_date", effectiveDate);
    return undefined;
  }
  const source = cell("cost_source") || null;
  const sourceReference = cell("cost_source_reference") || null;

  if (method === "recipe_derived") {
    if (cell("reference_cost_amount")) {
      error("reference_cost_amount", "recipe_derived_has_no_amount", cell("reference_cost_amount"));
      return undefined;
    }
    return {
      operation: "change_to_recipe_derived",
      unit,
      taxBasis,
      effectiveFrom: effectiveDate || null,
      source,
      sourceReference,
    };
  }

  const amount = majorToMicrosExact(cell("reference_cost_amount"));
  if (amount.status === "blank") {
    error("reference_cost_amount", "manual_amount_blank");
    return undefined;
  }
  if (amount.status === "invalid") {
    error("reference_cost_amount", amount.reason, amount.sourceText);
    return undefined;
  }
  const currency = cell("cost_currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    error("cost_currency", currency ? "invalid_currency" : "manual_currency_blank", cell("cost_currency") || undefined);
    return undefined;
  }
  if (!effectiveDate) {
    error("cost_effective_date", "manual_effective_date_blank");
    return undefined;
  }
  return {
    operation: "set_manual",
    amountMicros: amount.value,
    currency,
    unit,
    taxBasis,
    effectiveFrom: effectiveDate,
    source,
    sourceReference,
  };
}

/**
 * Reviews the selling-tax and reference-cost cells of one QOS workbook
 * Variants or Modifier Options row. Modifier options carry no tax columns.
 */
export function reviewSellingTaxCostCells(
  sheet: "Variants" | "Modifier Options",
  values: Record<string, string | undefined>,
): SellingTaxCostRowReview {
  const diagnostics: SellingTaxCostDiagnostic[] = [];
  const tax: SellingTaxCostRowReview["tax"] = {};

  if (sheet === "Variants") {
    const basis = parseSellingTaxBasisToken(values.price_tax_basis);
    if (basis.status === "unknown") {
      diagnostics.push({
        capability: "unknown_tax_basis_token",
        severity: "error",
        column: "price_tax_basis",
        reason: "unknown_selling_tax_basis",
        sourceText: basis.sourceText,
      });
    } else if (basis.status === "ok") {
      tax.priceTaxBasis = basis.basis;
      if (basis.basis === "unconfirmed") {
        diagnostics.push({
          capability: "unconfirmed_selling_tax_basis",
          severity: "review",
          column: "price_tax_basis",
          reason: "selling_tax_basis_unconfirmed",
        });
      }
    }

    const rate = parseBasisPointsCell(values.tax_rate_basis_points);
    if (rate.status === "rate") {
      tax.taxRateBasisPoints = rate.basisPoints;
    } else if (rate.status !== "blank") {
      diagnostics.push({
        capability: "unresolved_tax_value",
        severity: "error",
        column: "tax_rate_basis_points",
        reason: rate.reason,
        sourceText: rate.sourceText,
      });
    }
  }

  const costPolicy = costPolicyFromCells(values, diagnostics);
  if (sheet === "Modifier Options") {
    for (const entry of diagnostics) {
      if (entry.capability === "variant_cost_policy_manual") entry.capability = "modifier_option_cost_policy_manual";
      if (entry.capability === "variant_cost_policy_recipe_derived") {
        entry.capability = "modifier_option_cost_policy_recipe_derived";
      }
    }
  }
  return { tax, ...(costPolicy ? { costPolicy } : {}), diagnostics };
}

export type FoodicsProductTaxCostReview = {
  /** Target: the product's default variant (single source of truth at the sellable). */
  target: "default_variant";
  tax: { priceTaxBasis?: SellingPriceTaxBasis; taxRateBasisPoints?: number };
  costPolicy?:
    | { operation: "set_manual"; amountMicros: bigint }
    | { operation: "change_to_recipe_derived"; pendingReview: true };
  diagnostics: SellingTaxCostDiagnostic[];
};

/**
 * Reviews a Foodics 2-Products row's tax %, inclusive/exclusive flag and
 * Product Cost for the product's default variant. Currency and effective
 * date for a manual cost come from the reviewed import context (QOS-194),
 * never from this helper.
 */
export function reviewFoodicsProductTaxCost(cells: {
  taxPercent?: string;
  taxTreatment?: string;
  productCost?: string;
}): FoodicsProductTaxCostReview {
  const diagnostics: SellingTaxCostDiagnostic[] = [];
  const tax: FoodicsProductTaxCostReview["tax"] = {};

  const rate = parseSourceTaxPercent(cells.taxPercent);
  if (rate.status === "rate") {
    tax.taxRateBasisPoints = rate.basisPoints;
  } else if (rate.status === "ambiguous") {
    diagnostics.push({
      capability: "ambiguous_tax_rate",
      severity: "review",
      column: "tax_percent",
      reason: rate.reason,
      sourceText: rate.sourceText,
    });
  } else if (rate.status !== "blank") {
    diagnostics.push({
      capability: "unresolved_tax_value",
      severity: "review",
      column: "tax_percent",
      reason: rate.reason,
      sourceText: rate.sourceText,
    });
  }

  const basis = parseSellingTaxBasisToken(cells.taxTreatment);
  if (basis.status === "ok") {
    tax.priceTaxBasis = basis.basis;
  } else if (basis.status === "unknown") {
    diagnostics.push({
      capability: "unknown_tax_basis_token",
      severity: "review",
      column: "tax_treatment",
      reason: "unknown_selling_tax_basis",
      sourceText: basis.sourceText,
    });
  }

  const cost = convertFoodicsProductCost(cells.productCost);
  let costPolicy: FoodicsProductTaxCostReview["costPolicy"];
  if (cost.status === "manual") {
    costPolicy = { operation: "set_manual", amountMicros: cost.amountMicros };
  } else if (cost.status === "recipe_derived_pending_review") {
    costPolicy = { operation: "change_to_recipe_derived", pendingReview: true };
    diagnostics.push({
      capability: "foodics_blank_cost_recipe_derived",
      severity: "review",
      column: "product_cost",
      reason: cost.reason,
    });
  } else {
    diagnostics.push({
      capability: "variant_cost_policy_manual",
      severity: "error",
      column: "product_cost",
      reason: cost.reason,
      sourceText: cost.sourceText,
    });
  }

  return { target: "default_variant", tax, ...(costPolicy ? { costPolicy } : {}), diagnostics };
}
