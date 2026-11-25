"use client";

import { useCallback, useEffect, useState } from "react";

import {
  costSummaryText,
  decimalText,
  MARGIN_REASON_LABEL,
  recipesApiPath,
  REJECTION_LABEL,
  TAX_BASIS_KEY,
  UNRESOLVED_REASON_LABEL,
} from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { PortalBadge, PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { ConfigurationPreviewView, ContributionView, PreviewOptionRef } from "@/lib/recipes/costing-service";
import type { DecimalView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 consumption preview, extended by QOS-199 into the consumption,
   cost and margin preview: what one sale (or several) of a variant with the
   chosen options uses on a business date, resolved by the server to exactly
   one approved recipe version or the direct-stock link, what that costs at
   today's reference costs and the ingredient margin against the configured
   price. Read-only: nothing is posted. Unknown costs and unconfirmed or
   mismatched bases show a reason, never a number. */

type Channel = { publicId: string; displayName: string; status: string };

function optionName(locale: StaffLocale, option: PreviewOptionRef) {
  return localName(locale, option.nameEn, option.nameAr).text;
}

/** A signed per-sale quantity shown without its sign; the label says whether it was added or removed. */
function unsigned(value: DecimalView): DecimalView {
  return { ...value, text: value.text.replace(/^-/, "") };
}

function breakdownText(locale: StaffLocale, contribution: ContributionView) {
  const values = {
    quantity: contribution.perSale ? decimalText(locale, unsigned(contribution.perSale)) : "",
    unit: isolateText(contribution.storageUnitCode ?? contribution.unitCode),
  };
  if (contribution.kind === "base") {
    return staffCopyWith(locale, "recipePreviewBase", values);
  }
  const option = isolateText(contribution.option ? optionName(locale, contribution.option) : "");
  return staffCopyWith(locale, contribution.kind === "remove" || contribution.kind === "replace_remove" ? "recipePreviewRemovedBy" : "recipePreviewAddedBy", {
    ...values,
    option,
  });
}

export function ConsumptionPreviewPanel({ tenantId, variantPublicId, today }: { tenantId: string; variantPublicId: string; today: string }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("1");
  const [applyDefaults, setApplyDefaults] = useState(true);
  const [channelPublicId, setChannelPublicId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ConfigurationPreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (query: { date: string; quantity: string; options: Record<string, number>; defaults: boolean; channel: string }) => {
      setError(null);
      const params = new URLSearchParams({ variantPublicId, date: query.date, quantity: query.quantity, defaults: query.defaults ? "auto" : "none" });
      for (const [option, count] of Object.entries(query.options)) {
        if (count > 0) params.append("option", `${option}:${count}`);
      }
      if (query.channel) params.set("channelPublicId", query.channel);
      const response = await inventoryApi<ConfigurationPreviewView>(recipesApiPath(tenantId, `/consumption-preview?${params.toString()}`));
      if (!response.ok) {
        setResult(null);
        setError(inventoryFailureText(locale, response, "recipesLoadError"));
        return;
      }
      setResult(response.data);
    },
    [locale, tenantId, variantPublicId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void run({ date: today, quantity: "1", options: {}, defaults: true, channel: "" });
      void inventoryApi<{ salesChannels: { channels: Channel[] } }>(`/api/tenants/${tenantId}/catalogue/sales-channels`).then((response) => {
        if (response.ok) setChannels(response.data.salesChannels.channels.filter((channel) => channel.status === "active"));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [run, tenantId, today]);

  const recipeName = result?.recipe ? localName(locale, result.recipe.nameEn, result.recipe.nameAr) : null;
  const groups = result?.groups.filter((group) => group.status === "active") ?? [];

  return (
    <div className="qosp-subcard qosp-recipe-preview" data-muted="true">
      <h3 className="qosp-subcard-title">
        {staffCopyWith(locale, "recipePreviewTitle", {
          // Non-breaking hyphens keep the date on one line in a narrow RTL heading.
          date: isolateText((result?.businessDate ?? date).replace(/-/g, "‑")),
        })}
      </h3>
      <div className="qosp-form-grid qosp-recipe-preview-form" data-columns="2">
        <PortalField label={t("recipePreviewDate")}>
          <input className="qos-input" dir="ltr" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </PortalField>
        <PortalField label={t("recipePreviewQuantity")}>
          <input className="qos-input" dir="ltr" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </PortalField>
        <PortalField label={t("recipePreviewChannel")}>
          <select className="qos-input" value={channelPublicId} onChange={(event) => setChannelPublicId(event.target.value)}>
            <option value="">{t("recipePreviewChannelCentral")}</option>
            {channels.map((channel) => (
              <option key={channel.publicId} value={channel.publicId}>
                {channel.displayName}
              </option>
            ))}
          </select>
        </PortalField>
        <PortalField label={t("recipePreviewDefaultsLabel")}>
          <label className="qosp-meta-line">
            <input type="checkbox" checked={applyDefaults} onChange={(event) => setApplyDefaults(event.target.checked)} />{" "}
            {t("recipePreviewDefaultsCheckbox")}
          </label>
        </PortalField>
      </div>
      {groups.length > 0 ? (
        <div className="qosp-stack qosp-inventory-notices">
          <strong className="qosp-meta-line">{t("recipePreviewOptions")}</strong>
          {groups.map((group) => (
            <fieldset key={group.publicId} className="qosp-subcard qosp-stack">
              <legend className="qosp-meta-line">
                <bdi dir={localName(locale, group.nameEn, group.nameAr).dir}>{localName(locale, group.nameEn, group.nameAr).text}</bdi>
              </legend>
              <ul className="qosp-stack" aria-label={localName(locale, group.nameEn, group.nameAr).text}>
                {group.options
                  .filter((option) => option.status === "active")
                  .map((option) => {
                    const count = chosen[option.publicId] ?? 0;
                    const label = localName(locale, option.nameEn, option.nameAr);
                    return (
                      <li key={option.publicId} className="qosp-meta-row">
                        <label className="qosp-meta-line">
                          <input
                            type="checkbox"
                            checked={count > 0}
                            onChange={(event) => setChosen({ ...chosen, [option.publicId]: event.target.checked ? 1 : 0 })}
                          />{" "}
                          <bdi dir={label.dir}>{label.text}</bdi>
                        </label>
                        {option.isDefault ? <PortalBadge tone="neutral">{t("recipePreviewDefault")}</PortalBadge> : null}
                        {option.maxQuantity > 1 && count > 0 ? (
                          <input
                            className="qos-input qosp-recipe-preview-count"
                            dir="ltr"
                            type="number"
                            min={1}
                            max={option.maxQuantity}
                            aria-label={t("recipePreviewOptionQuantity")}
                            value={count}
                            onChange={(event) => setChosen({ ...chosen, [option.publicId]: Math.max(1, Number(event.target.value) || 1) })}
                          />
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </fieldset>
          ))}
        </div>
      ) : null}
      <div className="qosp-button-row qosp-inventory-actions">
        <button
          type="button"
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
          onClick={() => void run({ date, quantity, options: chosen, defaults: applyDefaults, channel: channelPublicId })}
        >
          {t("recipePreviewRun")}
        </button>
      </div>
      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {result ? (
        <div className="qosp-stack qosp-inventory-notices">
          {result.status === "unresolved" ? (
            <PortalNotice tone="warning">
              {result.reason === "overlapping_versions"
                ? staffCopyWith(locale, "recipeUnresolvedOverlappingVersions", {
                    versions: isolateText(result.overlappingVersionNumbers.join(", ")),
                  })
                : t(UNRESOLVED_REASON_LABEL[result.reason!])}
            </PortalNotice>
          ) : result.kind === "recipe" && result.version && recipeName ? (
            <p className="qosp-inventory-sentence">
              {staffCopyWith(locale, "recipePreviewVersion", {
                number: isolateText(String(result.version.versionNumber)),
                recipe: isolateText(recipeName.text),
                quantity: isolateText(result.version.yieldQuantity),
                unit: isolateText(result.version.yieldUnitCode),
              })}
            </p>
          ) : (
            <p className="qosp-inventory-sentence">{t("recipePreviewDirect")}</p>
          )}
          {result.selections.length > 0 ? (
            <div className="qosp-meta-row" aria-label={t("recipePreviewSelected")}>
              {result.selections.map((selection) => (
                <PortalBadge key={selection.option.publicId} tone="neutral" wrap>
                  {staffCopyWith(locale, selection.source === "default" ? "recipePreviewSelectionDefault" : "recipePreviewSelection", {
                    option: isolateText(optionName(locale, selection.option)),
                    quantity: isolateText(String(selection.quantity)),
                  })}
                </PortalBadge>
              ))}
            </div>
          ) : null}
          {result.defaultsApplied ? <p className="qosp-meta-line">{t("recipePreviewDefaultsApplied")}</p> : null}
          {result.rejections.length > 0 ? (
            <PortalNotice tone="warning">
              <span>{t("recipePreviewRejected")}</span>
              <ul className="qosp-stack">
                {result.rejections.map((rejection, index) => (
                  <li key={`${rejection.code}-${index}`}>
                    {staffCopyWith(locale, REJECTION_LABEL[rejection.code], {
                      option: isolateText(rejection.options[0] ? optionName(locale, rejection.options[0]) : ""),
                      options: isolateText(rejection.options.map((option) => optionName(locale, option)).join(locale === "ar" ? "، " : ", ")),
                      group: isolateText(rejection.group ? localName(locale, rejection.group.nameEn, rejection.group.nameAr).text : ""),
                      item: isolateText(rejection.item ? localName(locale, rejection.item.nameEn, rejection.item.nameAr).text : ""),
                    })}
                  </li>
                ))}
              </ul>
            </PortalNotice>
          ) : null}
          {result.configurationStatus === "resolved" ? (
            <ul className="qosp-branch-list" aria-label={t("recipeLinesTitle")}>
              {result.perItem.map((entry) => {
                const item = localName(locale, entry.item.nameEn, entry.item.nameAr);
                const parts = result.contributions.filter((contribution) => contribution.item.publicId === entry.item.publicId);
                return (
                  <li key={entry.item.publicId} className="qosp-branch-row qosp-subcard" data-columns="3">
                    <div className="qosp-branch-row-main">
                      <strong className="qosp-branch-row-name" dir={item.dir}>
                        {item.text}
                      </strong>
                      {entry.item.kind === "prepared" ? <PortalBadge tone="neutral" wrap>{t("recipePreviewPrepared")}</PortalBadge> : null}
                    </div>
                    <div className="qosp-branch-row-main">
                      {entry.perSale && entry.total && entry.storageUnitCode ? (
                        <>
                          <span className="qosp-inventory-cost-amount">
                            {staffCopyWith(locale, "recipePreviewPerSale", { quantity: decimalText(locale, entry.perSale), unit: isolateText(entry.storageUnitCode) })}
                          </span>
                          <span className="qosp-inventory-cost-amount qosp-meta-line">
                            {staffCopyWith(locale, "recipePreviewTotal", { quantity: decimalText(locale, entry.total), unit: isolateText(entry.storageUnitCode) })}
                          </span>
                        </>
                      ) : (
                        <PortalBadge tone="warm" wrap>
                          {t("recipeStateMissingConversion")}
                        </PortalBadge>
                      )}
                    </div>
                    <div className="qosp-branch-row-status qosp-stack">
                      {parts.map((part, index) => (
                        <span key={`${part.kind}-${part.effectPublicId ?? part.linePublicId ?? index}`} className="qosp-meta-line">
                          {part.status === "ok" ? breakdownText(locale, part) : t("recipeStateMissingConversion")}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : result.lines.length > 0 ? (
            <ul className="qosp-branch-list" aria-label={t("recipeLinesTitle")}>
              {result.lines.map((line) => {
                const item = localName(locale, line.item.nameEn, line.item.nameAr);
                return (
                  <li key={line.linePublicId ?? line.item.publicId} className="qosp-branch-row qosp-subcard" data-columns="3">
                    <div className="qosp-branch-row-main">
                      <strong className="qosp-branch-row-name" dir={item.dir}>
                        {item.text}
                      </strong>
                      {line.prepared ? <PortalBadge tone="neutral" wrap>{t("recipePreviewPrepared")}</PortalBadge> : null}
                    </div>
                    <div className="qosp-branch-row-main">
                      {line.perSale && line.total && line.storageUnitCode ? (
                        <>
                          <span className="qosp-inventory-cost-amount">
                            {staffCopyWith(locale, "recipePreviewPerSale", { quantity: decimalText(locale, line.perSale), unit: isolateText(line.storageUnitCode) })}
                          </span>
                          <span className="qosp-inventory-cost-amount qosp-meta-line">
                            {staffCopyWith(locale, "recipePreviewTotal", { quantity: decimalText(locale, line.total), unit: isolateText(line.storageUnitCode) })}
                          </span>
                        </>
                      ) : (
                        <PortalBadge tone="warm" wrap>
                          {t(line.status === "item_archived" ? "recipeStateItemArchived" : line.status === "storage_unit_missing" ? "recipeStorageUnitMissing" : "recipeStateMissingConversion")}
                        </PortalBadge>
                      )}
                    </div>
                    <div className="qosp-branch-row-status">
                      <span className="qosp-meta-line">
                        {staffCopyWith(locale, "recipePreviewSource", { quantity: isolateText(line.quantity), unit: isolateText(line.unitCode) })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {result.configurationStatus === "resolved" && !result.configurationComplete ? (
            <PortalNotice tone="warning">{t("recipePreviewIncomplete")}</PortalNotice>
          ) : null}
          <CostBlock locale={locale} result={result} />
          <MarginBlock locale={locale} result={result} />
          <p className="qosp-meta-line">{t("recipePreviewNothingPosted")}</p>
        </div>
      ) : null}
    </div>
  );
}

function CostBlock({ locale, result }: { locale: StaffLocale; result: ConfigurationPreviewView }) {
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const cost = result.cost;
  const manual = cost.components.filter((component) => component.method === "manual");
  return (
    <div className="qosp-subcard qosp-stack" data-testid="recipe-preview-cost">
      <strong className="qosp-subcard-title">{t("recipeCostTitle")}</strong>
      {cost.status === "known" ? (
        <>
          <span className="qosp-inventory-cost-amount">
            {staffCopyWith(locale, "recipeCostPerSale", { amount: decimalText(locale, cost.perSale), currency: isolateText(cost.currency) })}
          </span>
          <span className="qosp-inventory-cost-amount">
            {staffCopyWith(locale, "recipeCostForQuantity", { amount: decimalText(locale, cost.total), currency: isolateText(cost.currency) })}
          </span>
          <span className="qosp-meta-line">{staffCopyWith(locale, "recipeCostTaxBasis", { basis: t(TAX_BASIS_KEY[cost.taxBasis]!) })}</span>
        </>
      ) : (
        <PortalNotice tone="warning">
          {cost.reason === "incomplete"
            ? staffCopyWith(locale, "recipeCostIncomplete", { count: staffCount(locale, "recipeComponentsWithoutCost", cost.missingCount) })
            : cost.reason === "attribution_unavailable"
              ? staffCopyWith(locale, "recipeCostAttributionUnavailable", {
                  option: isolateText(cost.attributionOptions.map((option) => optionName(locale, option)).join(locale === "ar" ? "، " : ", ")),
                })
              : t(cost.reason === "currency_mismatch" ? "recipeCostCurrencyMismatch" : cost.reason === "rejected" ? "recipeCostRejected" : "recipeCostUnresolved")}
        </PortalNotice>
      )}
      {manual.map((component) =>
        component.amount && component.currency ? (
          <span key={component.option?.publicId ?? "base"} className="qosp-meta-line qosp-inventory-cost-amount">
            {component.source === "base"
              ? staffCopyWith(locale, "recipeCostManualBase", { amount: decimalText(locale, component.amount), currency: isolateText(component.currency) })
              : staffCopyWith(locale, "recipeCostManualOption", {
                  option: isolateText(component.option ? optionName(locale, component.option) : ""),
                  amount: decimalText(locale, component.amount),
                  currency: isolateText(component.currency),
                })}
          </span>
        ) : null,
      )}
      {result.batchCost?.status === "known" ? (
        <span className="qosp-meta-line qosp-inventory-cost-amount">
          {costSummaryText(locale, result.batchCost, result.version?.yieldUnitCode ?? null)}
        </span>
      ) : null}
    </div>
  );
}

function MarginBlock({ locale, result }: { locale: StaffLocale; result: ConfigurationPreviewView }) {
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const { price, margin } = result;
  return (
    <div className="qosp-subcard qosp-stack" data-testid="recipe-preview-margin">
      <strong className="qosp-subcard-title">{t("recipeMarginTitle")}</strong>
      <p className="qosp-meta-line">{t("recipeMarginHelp")}</p>
      {price.status === "available" ? (
        <span className="qosp-meta-line qosp-inventory-cost-amount">
          {staffCopyWith(locale, "recipeMarginPrice", {
            amount: isolateText(price.total),
            currency: isolateText(price.currency),
            basis: t(
              price.priceTaxBasis === "inclusive"
                ? "sellableTaxBasisInclusive"
                : price.priceTaxBasis === "exclusive"
                  ? "sellableTaxBasisExclusive"
                  : price.priceTaxBasis === "unconfirmed"
                    ? "sellableTaxBasisUnconfirmed"
                    : "sellableTaxBasisUndeclared",
            ),
          })}
        </span>
      ) : null}
      {price.channel ? (
        <span className="qosp-meta-line">
          {staffCopyWith(locale, price.status === "available" && price.baseInheritance === "override" ? "recipePreviewChannelOverride" : "recipePreviewChannelInherited", {
            channel: isolateText(price.channel.displayName),
          })}
        </span>
      ) : null}
      {margin.status === "available" ? (
        <>
          <span className="qosp-inventory-cost-amount">
            {staffCopyWith(locale, "recipeMarginLine", {
              amount: isolateText(margin.margin),
              currency: isolateText(margin.currency),
              percent: isolateText(margin.marginPercent.text),
              basis: t(margin.basis === "net" ? "sellableMarginBasisNet" : "sellableMarginBasisGross"),
            })}
          </span>
          {margin.marginPercent.rounded || margin.rounding === "half_up_micros" ? <span className="qosp-meta-line">{t("recipeMarginRounded")}</span> : null}
        </>
      ) : (
        <PortalNotice tone="warning">{staffCopyWith(locale, "recipeMarginUnavailable", { reason: t(MARGIN_REASON_LABEL[margin.reason]) })}</PortalNotice>
      )}
    </div>
  );
}
