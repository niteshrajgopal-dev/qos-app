"use client";

import { useState } from "react";

import { PortalBadge, PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import type {
  CostPolicyOperationInput,
  ReferenceMarginView,
  SellableReferenceCostView,
} from "@/lib/catalogue/reference-cost-policies";
import {
  basisPointsAsWholePercent,
  isCalendarDate,
  majorToMicrosExact,
  parseBasisPointsCell,
  percentInputToBasisPoints,
  type ReferenceCostTaxBasis,
  type ReferenceCostUnit,
  type SellingPriceTaxBasis,
} from "@/lib/catalogue/selling-tax-cost";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, type StaffUiCopyKey, staffCopyWith, staffUiCopy } from "@/lib/staff/locale";

/* QOS-215 back-office fields for a sellable's selling-price tax and
   reference-cost policy. Values are shown as stored and converted only with
   the exact helpers; nothing is defaulted (no 5% pre-fill, no currency or
   date guess) and a missing cost is never shown as zero. QOS-199: a
   recipe-derived variant policy shows the amount the recipe engine computed
   for the base configuration, or the specific reason it has none; an option's
   recipe-derived cost is computed per configuration in the recipe preview. */

export type SellableTaxValue = {
  priceTaxBasis: SellingPriceTaxBasis | null;
  taxRateBasisPoints: number | null;
  taxProvenance: string | null;
};

export type SellingTaxPatch = {
  priceTaxBasis: SellingPriceTaxBasis | null;
  taxRateBasisPoints: number | null;
};

const TAX_BASIS_LABEL: Record<SellingPriceTaxBasis, StaffUiCopyKey> = {
  inclusive: "sellableTaxBasisInclusive",
  exclusive: "sellableTaxBasisExclusive",
  unconfirmed: "sellableTaxBasisUnconfirmed",
};

const COST_UNIT_LABEL: Record<ReferenceCostUnit, StaffUiCopyKey> = {
  each: "sellableCostUnitEach",
  kg: "sellableCostUnitKg",
  g: "sellableCostUnitG",
};

const COST_TAX_BASIS_LABEL: Record<ReferenceCostTaxBasis, StaffUiCopyKey> = {
  net: "sellableCostTaxBasisNet",
  gross: "sellableCostTaxBasisGross",
  unconfirmed: "sellableTaxBasisUnconfirmed",
};

const PROVENANCE_LABEL: Record<string, StaffUiCopyKey> = {
  operator_entered: "sellableProvenanceOperatorEntered",
  imported: "sellableProvenanceImported",
  synthetic_fixture: "sellableProvenanceSyntheticFixture",
  ai_generated: "sellableProvenanceAiGenerated",
};

const COST_STATUS_LABEL: Record<string, StaffUiCopyKey> = {
  no_policy: "sellableCostStatusNoPolicy",
  unconfirmed_cost_tax_basis: "sellableCostStatusUnconfirmedTaxBasis",
  missing_cost_tax_basis: "sellableCostStatusMissingTaxBasis",
  missing_currency: "sellableCostStatusMissingCurrency",
  missing_amount: "sellableCostStatusMissingAmount",
  missing_effective_date: "sellableCostStatusMissingEffectiveDate",
};

const MARGIN_REASON_LABEL: Record<string, StaffUiCopyKey> = {
  missing_price: "sellableMarginReasonMissingPrice",
  missing_selling_tax_basis: "sellableMarginReasonMissingSellingTaxBasis",
  unconfirmed_selling_tax_basis: "sellableMarginReasonUnconfirmedSellingTaxBasis",
  missing_tax_rate: "sellableMarginReasonMissingTaxRate",
  cost_unavailable: "sellableMarginReasonCostUnavailable",
  recipe_derived_cost_not_computed: "sellableMarginReasonRecipeNotComputed",
  recipe_no_link: "sellableMarginReasonRecipeNoLink",
  recipe_no_version: "sellableMarginReasonRecipeNoVersion",
  recipe_incomplete: "sellableMarginReasonRecipeIncomplete",
  recipe_unresolved: "sellableMarginReasonRecipeUnresolved",
  unconfirmed_cost_tax_basis: "sellableMarginReasonUnconfirmedCost",
  mixed_cost_tax_basis: "sellableMarginReasonMixedCost",
  currency_mismatch: "sellableMarginReasonCurrencyMismatch",
  cost_unit_not_each: "sellableMarginReasonCostUnitNotEach",
};

const COMPUTED_BASIS_LABEL: Record<string, StaffUiCopyKey> = {
  net: "sellableCostTaxBasisNet",
  gross: "sellableCostTaxBasisGross",
  unconfirmed: "sellableTaxBasisUnconfirmed",
  mixed: "sellableCostTaxBasisMixed",
};

function provenanceText(locale: StaffLocale, provenance: string | null) {
  const key = provenance ? PROVENANCE_LABEL[provenance] : undefined;
  return staffUiCopy(locale, key ?? "sellableProvenanceNone");
}

/** "5%" for a whole percent, otherwise the exact basis points. */
export function taxRateText(locale: StaffLocale, basisPoints: number | null) {
  if (basisPoints == null) {
    return staffUiCopy(locale, "sellableTaxRateNotRecorded");
  }
  const percent = basisPointsAsWholePercent(basisPoints);
  return percent != null
    ? `${percent}%`
    : `${basisPoints} ${staffUiCopy(locale, "sellableTaxRateUnitBasisPoints")}`;
}

export function costPolicySummaryText(locale: StaffLocale, referenceCost: SellableReferenceCostView) {
  const policy = referenceCost.policy;
  if (!policy) {
    return staffUiCopy(locale, "sellableCostNone");
  }
  if (policy.method === "recipe_derived") {
    return staffUiCopy(locale, "sellableCostMethodRecipeDerived");
  }
  return `${staffUiCopy(locale, "sellableCostMethodManual")}: ${policy.amountMajor} ${policy.currency ?? ""}`.trim();
}

export function ReferenceMarginLine({
  locale,
  margin,
}: {
  locale: StaffLocale;
  margin: ReferenceMarginView;
}) {
  if (margin.status === "available") {
    return (
      <p className="qosp-meta-line" dir="auto">
        {staffUiCopy(locale, "sellableMarginLabel")}:{" "}
        <bdi dir="ltr">
          {staffCopyWith(locale, "sellableMarginAvailable", {
            amount: margin.marginMajor,
            currency: margin.currency,
            basis: staffUiCopy(locale, margin.basis === "net" ? "sellableMarginBasisNet" : "sellableMarginBasisGross"),
          })}
        </bdi>
        {margin.rounding === "half_up_micros" ? ` ${staffUiCopy(locale, "sellableMarginRounded")}` : null}
      </p>
    );
  }
  return (
    <p className="qosp-meta-line">
      {staffUiCopy(locale, "sellableMarginLabel")}:{" "}
      {staffCopyWith(locale, "sellableMarginUnavailable", {
        reason: staffUiCopy(locale, MARGIN_REASON_LABEL[margin.reason] ?? "sellableMarginReasonCostUnavailable"),
      })}
    </p>
  );
}

/** What a recipe-derived policy resolves to: the computed amount with its recipe, or why there is none. */
export function RecipeDerivedLine({ locale, referenceCost }: { locale: StaffLocale; referenceCost: SellableReferenceCostView }) {
  const { resolution } = referenceCost;
  if (resolution.status === "recipe_derived_computed") {
    const amount = { amount: isolateText(resolution.amountMajor), currency: isolateText(resolution.currency) };
    const recipeName = resolution.recipe
      ? locale === "ar" && resolution.recipe.nameAr
        ? resolution.recipe.nameAr
        : resolution.recipe.nameEn
      : null;
    return (
      <div className="qosp-stack" data-testid="recipe-derived-line">
        <p className="qosp-meta-line">
          {recipeName && resolution.versionNumber !== null
            ? staffCopyWith(locale, "sellableCostRecipeComputedLine", {
                ...amount,
                recipe: isolateText(recipeName),
                number: isolateText(String(resolution.versionNumber)),
              })
            : staffCopyWith(locale, "sellableCostDirectStockComputedLine", amount)}
        </p>
        <p className="qosp-meta-line">
          {staffCopyWith(locale, "sellableCostComputedBasis", { basis: staffUiCopy(locale, COMPUTED_BASIS_LABEL[resolution.taxBasis]!) })}
          {resolution.rounding === "half_up_micros" ? ` ${staffUiCopy(locale, "sellableCostComputedRounded")}` : null}
        </p>
      </div>
    );
  }
  if (resolution.status === "recipe_derived_reference") {
    if (resolution.reason === "computed_per_configuration") {
      return <p className="qosp-meta-line">{staffUiCopy(locale, "sellableCostOptionRecipePreview")}</p>;
    }
    return (
      <p className="qosp-meta-line" data-testid="recipe-derived-line">
        {staffCopyWith(locale, "sellableMarginUnavailable", { reason: staffUiCopy(locale, MARGIN_REASON_LABEL[resolution.reason]!) })}
      </p>
    );
  }
  return null;
}

function CostResolutionLine({
  locale,
  referenceCost,
}: {
  locale: StaffLocale;
  referenceCost: SellableReferenceCostView;
}) {
  const { policy, resolution } = referenceCost;
  return (
    <div className="qosp-meta-row">
      <PortalBadge tone={resolution.status === "manual_reference" || resolution.status === "recipe_derived_computed" ? "positive" : "neutral"}>
        {costPolicySummaryText(locale, referenceCost)}
      </PortalBadge>
      {resolution.status === "unavailable" && policy ? (
        <PortalBadge tone="warm">{staffUiCopy(locale, COST_STATUS_LABEL[resolution.reason] ?? "sellableCostNone")}</PortalBadge>
      ) : null}
      {policy ? (
        <span className="qosp-meta-line">
          {staffCopyWith(locale, "sellableCostRevision", {
            revision: policy.revision,
            date: policy.effectiveFrom ?? "—",
          })}
          {" · "}
          {staffUiCopy(locale, "sellableProvenanceLabel")}: {provenanceText(locale, policy.provenance)}
        </span>
      ) : null}
    </div>
  );
}

type RateUnit = "percent" | "basis_points";

function initialRate(basisPoints: number | null): { unit: RateUnit; text: string } {
  if (basisPoints == null) {
    return { unit: "percent", text: "" };
  }
  const percent = basisPointsAsWholePercent(basisPoints);
  return percent != null ? { unit: "percent", text: percent } : { unit: "basis_points", text: String(basisPoints) };
}

/** Selling-price tax basis, rate and provenance for one variant. */
export function SellingTaxEditor({
  locale,
  value,
  disabled,
  onSave,
}: {
  locale: StaffLocale;
  value: SellableTaxValue;
  disabled: boolean;
  onSave: (patch: SellingTaxPatch) => void;
}) {
  const copy = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [basis, setBasis] = useState<SellingPriceTaxBasis | "">(value.priceTaxBasis ?? "");
  const [rate, setRate] = useState(() => initialRate(value.taxRateBasisPoints));
  const [rateError, setRateError] = useState(false);

  function save() {
    const parsed = rate.unit === "percent" ? percentInputToBasisPoints(rate.text) : parseBasisPointsCell(rate.text);
    if (parsed.status !== "rate" && parsed.status !== "blank") {
      setRateError(true);
      return;
    }
    setRateError(false);
    onSave({
      priceTaxBasis: basis === "" ? null : basis,
      taxRateBasisPoints: parsed.status === "rate" ? parsed.basisPoints : null,
    });
  }

  return (
    <div className="qosp-stack">
      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("sellableTaxBasisLabel")}>
          <select
            className="qos-input"
            value={basis}
            disabled={disabled}
            onChange={(event) => setBasis(event.target.value as SellingPriceTaxBasis | "")}
          >
            <option value="">{copy("sellableTaxBasisUndeclared")}</option>
            {(["inclusive", "exclusive", "unconfirmed"] as const).map((entry) => (
              <option key={entry} value={entry}>
                {copy(TAX_BASIS_LABEL[entry])}
              </option>
            ))}
          </select>
        </PortalField>
        <PortalField label={copy("sellableTaxRateLabel")} help={copy("sellableTaxRateHelp")}>
          <input
            className="qos-input"
            inputMode="decimal"
            dir="ltr"
            value={rate.text}
            disabled={disabled}
            aria-invalid={rateError || undefined}
            onChange={(event) => setRate({ ...rate, text: event.target.value })}
          />
        </PortalField>
        <PortalField label={copy("sellableTaxRateUnitLabel")}>
          <select
            className="qos-input"
            value={rate.unit}
            disabled={disabled}
            onChange={(event) => setRate({ ...rate, unit: event.target.value as RateUnit })}
          >
            <option value="percent">{copy("sellableTaxRateUnitPercent")}</option>
            <option value="basis_points">{copy("sellableTaxRateUnitBasisPoints")}</option>
          </select>
        </PortalField>
        <PortalField label={copy("sellableProvenanceLabel")}>
          <span className="qosp-meta-line">{provenanceText(locale, value.taxProvenance)}</span>
        </PortalField>
      </div>
      {rateError ? <PortalNotice tone="error">{copy("sellableTaxRateInvalid")}</PortalNotice> : null}
      <div className="qosp-button-row">
        <button
          type="button"
          disabled={disabled}
          onClick={save}
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
        >
          {copy("sellableTaxSave")}
        </button>
      </div>
    </div>
  );
}

type CostForm = {
  amount: string;
  currency: string;
  unit: ReferenceCostUnit | "";
  taxBasis: ReferenceCostTaxBasis | "";
  effectiveFrom: string;
  source: string;
  sourceReference: string;
};

function initialCostForm(referenceCost: SellableReferenceCostView): CostForm {
  const policy = referenceCost.policy;
  return {
    amount: policy?.amountMajor ?? "",
    currency: policy?.currency ?? "",
    unit: policy?.unit ?? "",
    taxBasis: policy?.taxBasis ?? "",
    effectiveFrom: policy?.effectiveFrom ?? "",
    source: policy?.source ?? "",
    sourceReference: policy?.sourceReference ?? "",
  };
}

/** Reference-cost policy for a variant or modifier option: explicit operations only. */
export function ReferenceCostEditor({
  locale,
  referenceCost,
  disabled,
  note,
  onApply,
}: {
  locale: StaffLocale;
  referenceCost: SellableReferenceCostView;
  disabled: boolean;
  note?: string;
  onApply: (operation: CostPolicyOperationInput) => void;
}) {
  const copy = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [form, setForm] = useState<CostForm>(() => initialCostForm(referenceCost));
  const [problem, setProblem] = useState<StaffUiCopyKey | null>(null);
  const optional = {
    unit: form.unit === "" ? null : form.unit,
    taxBasis: form.taxBasis === "" ? null : form.taxBasis,
    source: form.source.trim() || null,
    sourceReference: form.sourceReference.trim() || null,
  };

  function setManual() {
    const amount = majorToMicrosExact(form.amount);
    if (amount.status === "invalid") {
      setProblem("sellableCostAmountInvalid");
      return;
    }
    const currency = form.currency.trim().toUpperCase();
    if (amount.status === "blank" || !/^[A-Z]{3}$/.test(currency) || !isCalendarDate(form.effectiveFrom)) {
      setProblem("sellableCostIncomplete");
      return;
    }
    setProblem(null);
    onApply({
      operation: "set_manual",
      amount: form.amount.trim(),
      currency,
      effectiveFrom: form.effectiveFrom,
      ...optional,
    });
  }

  function useRecipe() {
    setProblem(null);
    onApply({
      operation: "change_to_recipe_derived",
      effectiveFrom: isCalendarDate(form.effectiveFrom) ? form.effectiveFrom : null,
      ...optional,
    });
  }

  return (
    <div className="qosp-stack">
      <CostResolutionLine locale={locale} referenceCost={referenceCost} />
      {referenceCost.policy?.method === "recipe_derived" ? (
        <>
          <p className="qosp-meta-line">{copy("sellableCostRecipeDerivedNote")}</p>
          <RecipeDerivedLine locale={locale} referenceCost={referenceCost} />
        </>
      ) : null}
      {note ? <p className="qosp-meta-line">{note}</p> : null}
      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("sellableCostAmountLabel")} help={copy("sellableCostAmountHelp")}>
          <input
            className="qos-input"
            inputMode="decimal"
            dir="ltr"
            value={form.amount}
            disabled={disabled}
            aria-invalid={problem === "sellableCostAmountInvalid" || undefined}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </PortalField>
        <PortalField label={copy("sellableCostCurrencyLabel")}>
          <input
            className="qos-input"
            dir="ltr"
            maxLength={3}
            value={form.currency}
            disabled={disabled}
            onChange={(event) => setForm({ ...form, currency: event.target.value })}
          />
        </PortalField>
        <PortalField label={copy("sellableCostUnitLabel")}>
          <select
            className="qos-input"
            value={form.unit}
            disabled={disabled}
            onChange={(event) => setForm({ ...form, unit: event.target.value as CostForm["unit"] })}
          >
            <option value="">{copy("sellableCostUnitBlank")}</option>
            {(["each", "kg", "g"] as const).map((unit) => (
              <option key={unit} value={unit}>
                {copy(COST_UNIT_LABEL[unit])}
              </option>
            ))}
          </select>
        </PortalField>
        <PortalField label={copy("sellableCostTaxBasisLabel")}>
          <select
            className="qos-input"
            value={form.taxBasis}
            disabled={disabled}
            onChange={(event) => setForm({ ...form, taxBasis: event.target.value as CostForm["taxBasis"] })}
          >
            <option value="">{copy("sellableTaxBasisUndeclared")}</option>
            {(["net", "gross", "unconfirmed"] as const).map((basis) => (
              <option key={basis} value={basis}>
                {copy(COST_TAX_BASIS_LABEL[basis])}
              </option>
            ))}
          </select>
        </PortalField>
        <PortalField label={copy("sellableCostEffectiveFromLabel")}>
          <input
            type="date"
            className="qos-input"
            dir="ltr"
            value={form.effectiveFrom}
            disabled={disabled}
            onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
          />
        </PortalField>
        <PortalField label={copy("sellableCostSourceLabel")}>
          <input
            className="qos-input"
            dir="auto"
            value={form.source}
            disabled={disabled}
            onChange={(event) => setForm({ ...form, source: event.target.value })}
          />
        </PortalField>
        <PortalField label={copy("sellableCostSourceReferenceLabel")}>
          <input
            className="qos-input"
            dir="auto"
            value={form.sourceReference}
            disabled={disabled}
            onChange={(event) => setForm({ ...form, sourceReference: event.target.value })}
          />
        </PortalField>
      </div>
      {problem ? <PortalNotice tone="error">{copy(problem)}</PortalNotice> : null}
      <div className="qosp-button-row">
        <button type="button" disabled={disabled} onClick={setManual} className="qos-btn" data-variant="secondary" data-size="sm">
          {copy("sellableCostSetManual")}
        </button>
        <button type="button" disabled={disabled} onClick={useRecipe} className="qos-btn" data-variant="secondary" data-size="sm">
          {copy("sellableCostUseRecipe")}
        </button>
        {referenceCost.policy ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApply({ operation: "clear" })}
            className="qos-btn"
            data-variant="danger"
            data-size="sm"
          >
            {copy("sellableCostClear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Read-mostly summary of the default variant's tax, cost and margin for the product pricing section. */
export function SellableTaxCostSummary({
  locale,
  tax,
  referenceCost,
  referenceMargin,
}: {
  locale: StaffLocale;
  tax: SellableTaxValue;
  referenceCost: SellableReferenceCostView;
  referenceMargin: ReferenceMarginView;
}) {
  const copy = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  return (
    <div className="qosp-stack" data-testid="sellable-tax-cost-summary">
      <p className="qosp-meta-line">{copy("sellableTaxCostDefaultSummaryHelp")}</p>
      <p className="qosp-meta-line">
        {copy("sellableTaxBasisLabel")}:{" "}
        {copy(tax.priceTaxBasis ? TAX_BASIS_LABEL[tax.priceTaxBasis] : "sellableTaxBasisUndeclared")}
        {" · "}
        {copy("sellableTaxRateLabel")}: <bdi dir="ltr">{taxRateText(locale, tax.taxRateBasisPoints)}</bdi>
        {" · "}
        {copy("sellableProvenanceLabel")}: {provenanceText(locale, tax.taxProvenance)}
      </p>
      <CostResolutionLine locale={locale} referenceCost={referenceCost} />
      {referenceCost.policy?.method === "recipe_derived" ? (
        <>
          <p className="qosp-meta-line">{copy("sellableCostRecipeDerivedNote")}</p>
          <RecipeDerivedLine locale={locale} referenceCost={referenceCost} />
        </>
      ) : null}
      <ReferenceMarginLine locale={locale} margin={referenceMargin} />
    </div>
  );
}
