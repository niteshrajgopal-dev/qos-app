"use client";

import { PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import {
  directStockMappingState,
  type PriceUnit,
  type SellingQuantityBasis,
  sellingBasisState,
} from "@/lib/catalogue/selling-attributes";
import { staffUiCopy, type StaffLocale } from "@/lib/staff/locale";

import {
  booleanFromTriState,
  parseOptionalPositiveNumber,
  type TriState,
} from "@/app/tenants/[tenantId]/catalogue/products/selling-attributes-form";

export type ProductSellingAttributesFormState = {
  preparationTimeMinutes: string;
  walkingTimeMinutes: string;
  highSalt: TriState;
  directStockIntent: TriState;
};

function TriStateSelect({
  locale,
  value,
  disabled,
  onChange,
}: {
  locale: StaffLocale;
  value: TriState;
  disabled?: boolean;
  onChange: (value: TriState) => void;
}) {
  return (
    <select
      className="qos-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as TriState)}
    >
      <option value="unknown">{staffUiCopy(locale, "productEditorTriStateUnknown")}</option>
      <option value="yes">{staffUiCopy(locale, "productEditorTriStateYes")}</option>
      <option value="no">{staffUiCopy(locale, "productEditorTriStateNo")}</option>
    </select>
  );
}

export function ProductSellingAttributesFields({
  locale,
  businessProfile,
  value,
  fieldError,
  disabled,
  onChange,
}: {
  locale: StaffLocale;
  businessProfile: "hospitality" | "generic_retail";
  value: ProductSellingAttributesFormState;
  fieldError: string | null;
  disabled?: boolean;
  onChange: (patch: Partial<ProductSellingAttributesFormState>) => void;
}) {
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  const hospitality = businessProfile === "hospitality";
  const stockMapping = directStockMappingState(booleanFromTriState(value.directStockIntent));

  return (
    <div className="qosp-stack">
      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("productEditorPrepTimeLabel")} help={copy("productEditorPrepTimeHelp")}>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            dir="ltr"
            className="qos-input"
            value={value.preparationTimeMinutes}
            disabled={disabled}
            aria-invalid={fieldError === "preparationTimeMinutes" || undefined}
            onChange={(event) => onChange({ preparationTimeMinutes: event.target.value })}
          />
        </PortalField>
        {hospitality ? (
          <PortalField label={copy("productEditorWalkingTimeLabel")} help={copy("productEditorWalkingTimeHelp")}>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              dir="ltr"
              className="qos-input"
              value={value.walkingTimeMinutes}
              disabled={disabled}
              aria-invalid={fieldError === "walkingTimeMinutes" || undefined}
              onChange={(event) => onChange({ walkingTimeMinutes: event.target.value })}
            />
          </PortalField>
        ) : null}
        {hospitality ? (
          <PortalField label={copy("productEditorHighSaltLabel")}>
            <TriStateSelect
              locale={locale}
              value={value.highSalt}
              disabled={disabled}
              onChange={(highSalt) => onChange({ highSalt })}
            />
          </PortalField>
        ) : null}
        <PortalField label={copy("productEditorStockIntentLabel")} help={copy("productEditorStockIntentHelp")}>
          <TriStateSelect
            locale={locale}
            value={value.directStockIntent}
            disabled={disabled}
            onChange={(directStockIntent) => onChange({ directStockIntent })}
          />
        </PortalField>
      </div>
      {stockMapping === "unresolved" ? (
        <PortalNotice tone="warning">{copy("productEditorStockIntentUnresolved")}</PortalNotice>
      ) : null}
    </div>
  );
}

export type VariantSellingBasisFormState = {
  sellingQuantityBasis: SellingQuantityBasis | null;
  priceUnit: PriceUnit | null;
  priceUnitQuantityInput: string;
};

export function VariantSellingBasisFields({
  locale,
  value,
  disabled,
  onChange,
}: {
  locale: StaffLocale;
  value: VariantSellingBasisFormState;
  disabled?: boolean;
  onChange: (patch: Partial<VariantSellingBasisFormState>) => void;
}) {
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  const quantity = parseOptionalPositiveNumber(value.priceUnitQuantityInput);
  const state =
    quantity === "invalid"
      ? null
      : sellingBasisState({
          sellingQuantityBasis: value.sellingQuantityBasis,
          priceUnit: value.priceUnit,
          priceUnitQuantity: quantity,
        });

  return (
    <div className="qosp-stack">
      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("variantSellingBasisLabel")}>
          <select
            className="qos-select"
            value={value.sellingQuantityBasis ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({ sellingQuantityBasis: (event.target.value || null) as SellingQuantityBasis | null })
            }
          >
            <option value="">{copy("variantSellingBasisUndeclared")}</option>
            <option value="each">{copy("variantSellingBasisEach")}</option>
            <option value="weight">{copy("variantSellingBasisWeight")}</option>
          </select>
        </PortalField>
        <PortalField label={copy("variantPriceUnitLabel")}>
          <select
            className="qos-select"
            value={value.priceUnit ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ priceUnit: (event.target.value || null) as PriceUnit | null })}
          >
            <option value="">{copy("variantSellingBasisUndeclared")}</option>
            <option value="each">{copy("variantPriceUnitEach")}</option>
            <option value="kg">{copy("variantPriceUnitKg")}</option>
            <option value="g">{copy("variantPriceUnitG")}</option>
          </select>
        </PortalField>
        <PortalField label={copy("variantPriceUnitQuantityLabel")} help={copy("variantPriceUnitQuantityHelp")}>
          <input
            className="qos-input"
            inputMode="decimal"
            dir="ltr"
            value={value.priceUnitQuantityInput}
            disabled={disabled}
            aria-invalid={quantity === "invalid" || undefined}
            onChange={(event) => onChange({ priceUnitQuantityInput: event.target.value })}
          />
        </PortalField>
      </div>
      {quantity === "invalid" ? (
        <PortalNotice tone="error">{copy("variantPriceUnitQuantityInvalid")}</PortalNotice>
      ) : null}
      {state === "unresolved" ? (
        <PortalNotice tone="warning">{copy("variantWeightUnresolved")}</PortalNotice>
      ) : null}
      <p className="qosp-meta-line">{copy("variantSellingBasisNote")}</p>
    </div>
  );
}
