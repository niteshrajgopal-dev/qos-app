"use client";

import { useState } from "react";

import {
  COST_SOURCE_LABEL,
  COST_STATUS_LABEL,
  inventoryApi,
  inventoryFailureText,
  TAX_BASIS_LABEL,
} from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { Modal } from "@/components/Modal";
import { PortalBadge, PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { previewMissingText } from "@/lib/inventory/conversion-preview";
import type { CostPerUnit, CostSource, CostTaxBasis, KnownItemCost } from "@/lib/inventory/cost-completeness";
import type { ItemDetailView, ReferenceCostView } from "@/lib/inventory/items";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-197 reference cost panel. Shows the item's current reference estimate
   with its source, currency, unit, date and tax basis, what it means per
   storage and recipe unit, and every dated version. An item without a cost
   says so: unknown is never shown as zero. The estimate is kept apart from
   historical stock and recipe evidence, of which there is none yet. */

type Form = {
  amount: string;
  unitPublicId: string;
  taxBasis: CostTaxBasis;
  source: CostSource;
  sourceReference: string;
  effectiveFrom: string;
};

function formFrom(detail: ItemDetailView): Form {
  const current = detail.referenceCost.status === "unknown" ? null : detail.referenceCost;
  return {
    amount: current?.amount ?? "",
    unitPublicId: current?.unit.publicId ?? detail.item.storageUnitPublicId ?? "",
    taxBasis: current?.taxBasis ?? "unconfirmed",
    source: current?.source ?? "manual",
    sourceReference: current?.sourceReference ?? "",
    effectiveFrom: "",
  };
}

function costLine(locale: StaffLocale, amount: string, currency: string, unitCode: string) {
  return staffCopyWith(locale, "costCurrentLine", {
    amount: isolateText(amount),
    currency: isolateText(currency),
    unit: isolateText(unitCode),
  });
}

function PerUnitLine({ label, value, currency }: { label: StaffUiCopyKey; value: CostPerUnit; currency: string }) {
  const { locale } = useStaffLocale();
  return (
    <div className="qosp-inventory-cost-line">
      <span className="qosp-branch-row-label">{staffUiCopy(locale, label)}</span>
      {value.status === "derived" ? (
        <>
          <span className="qosp-inventory-cost-amount">{costLine(locale, value.text, currency, value.unit.code)}</span>
          {value.rounded ? (
            <span className="qosp-meta-line">
              {staffCopyWith(locale, "costRounded", { dp: isolateText(String(value.places)) })}
            </span>
          ) : null}
        </>
      ) : (
        <PortalBadge tone="warm" wrap>
          {previewMissingText(locale, value.reason)}
        </PortalBadge>
      )}
    </div>
  );
}

function CostBadges({ cost }: { cost: Pick<KnownItemCost, "taxBasis" | "source"> }) {
  const { locale } = useStaffLocale();
  return (
    <>
      <PortalBadge tone={cost.taxBasis === "unconfirmed" ? "warm" : "neutral"}>
        {staffUiCopy(locale, TAX_BASIS_LABEL[cost.taxBasis])}
      </PortalBadge>
      <PortalBadge tone="neutral">{staffUiCopy(locale, COST_SOURCE_LABEL[cost.source])}</PortalBadge>
    </>
  );
}

function HistoryRow({ row }: { row: ReferenceCostView }) {
  const { locale } = useStaffLocale();
  return (
    <li className="qosp-subcard qosp-inventory-rule" data-muted={row.current ? undefined : "true"}>
      <p className="qosp-inventory-sentence">{costLine(locale, row.amount, row.currency, row.unitCode)}</p>
      <div className="qosp-meta-row qosp-inventory-rule-meta">
        <CostBadges cost={row} />
        <span className="qosp-meta-line">
          {staffCopyWith(locale, "conversionEffectiveFrom", { date: isolateText(row.effectiveFrom) })}
        </span>
        {row.effectiveTo ? (
          <span className="qosp-meta-line">
            {staffCopyWith(locale, "conversionEffectiveTo", { date: isolateText(row.effectiveTo) })}
          </span>
        ) : null}
        <span className="qosp-meta-line">
          {staffCopyWith(locale, "conversionRevision", { revision: isolateText(String(row.revision)) })}
        </span>
        {row.current ? <PortalBadge tone="positive">{staffUiCopy(locale, "conversionCurrent")}</PortalBadge> : null}
      </div>
      {row.sourceReference ? (
        <p className="qosp-meta-line">{staffCopyWith(locale, "costSourceReferenceLine", { text: isolateText(row.sourceReference) })}</p>
      ) : null}
    </li>
  );
}

export function ItemCostPanel({
  tenantId,
  detail,
  canEdit,
  onChange,
}: {
  tenantId: string;
  detail: ItemDetailView;
  canEdit: boolean;
  onChange: (detail: ItemDetailView) => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [form, setForm] = useState<Form>(() => formFrom(detail));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [clearing, setClearing] = useState<{ effectiveFrom: string } | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cost = detail.referenceCost;
  const current = cost.status === "unknown" ? null : cost;
  const base = `/api/tenants/${tenantId}/inventory/items/${detail.item.publicId}/reference-costs`;
  const designated = [detail.item.storageUnitPublicId, detail.item.recipeUnitPublicId, detail.item.purchaseUnitPublicId];
  const costUnits = detail.units.filter((unit) => unit.status === "active" && designated.includes(unit.publicId));
  const unitLabel = (code: string, nameEn: string, nameAr: string) => `${code} · ${locale === "ar" ? nameAr : nameEn}`;

  function applied(next: ItemDetailView) {
    onChange(next);
    setForm(formFrom(next));
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<ItemDetailView>(base, {
      method: "POST",
      body: {
        amount: form.amount,
        unitPublicId: form.unitPublicId || null,
        taxBasis: form.taxBasis,
        source: form.source,
        sourceReference: form.sourceReference.trim() ? form.sourceReference : null,
        effectiveFrom: form.effectiveFrom || null,
        expectedRevision: current?.revision ?? null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    applied(result.data);
    setNotice({ tone: "success", text: t("costSaved") });
  }

  async function clear() {
    if (!current || !clearing) return;
    setBusy(true);
    setClearError(null);
    const result = await inventoryApi<ItemDetailView>(`${base}/${current.costPublicId}`, {
      method: "PATCH",
      body: { operation: "close", expectedRevision: current.revision, effectiveFrom: clearing.effectiveFrom || null },
    });
    setBusy(false);
    if (!result.ok) {
      setClearError(inventoryFailureText(locale, result));
      return;
    }
    setClearing(null);
    applied(result.data);
    setNotice({ tone: "success", text: t("costSaved") });
  }

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("costPanelTitle")}</h2>
      <p className="qosp-panel-help">{t("costPanelHelp")}</p>

      <div className="qosp-panel-body qosp-subcard qosp-inventory-rule">
        <div className="qosp-meta-row">
          <PortalBadge tone={cost.status === "known" ? "positive" : "warm"} wrap>
            {t(COST_STATUS_LABEL[cost.status])}
          </PortalBadge>
        </div>
        {current ? (
          <>
            <p className="qosp-inventory-sentence qosp-inventory-cost-amount">
              {costLine(locale, current.amount, current.currency, current.unit.code)}
            </p>
            <div className="qosp-meta-row qosp-inventory-rule-meta">
              <CostBadges cost={current} />
              <span className="qosp-meta-line">
                {staffCopyWith(locale, "costEffectiveFromLine", { date: isolateText(current.effectiveFrom) })}
              </span>
              <span className="qosp-meta-line">
                {staffCopyWith(locale, "conversionRevision", { revision: isolateText(String(current.revision)) })}
              </span>
            </div>
            {current.sourceReference ? (
              <p className="qosp-meta-line">
                {staffCopyWith(locale, "costSourceReferenceLine", { text: isolateText(current.sourceReference) })}
              </p>
            ) : null}
            <PerUnitLine label="costPerStorageUnit" value={current.perStorageUnit} currency={current.currency} />
            <PerUnitLine label="costPerRecipeUnit" value={current.perRecipeUnit} currency={current.currency} />
          </>
        ) : (
          <PortalNotice tone="info">{t("costUnknownNote")}</PortalNotice>
        )}
      </div>

      {notice ? (
        <div className="qosp-panel-body">
          <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
        </div>
      ) : null}

      {canEdit ? (
        <div className="qosp-panel-body qosp-subcard" data-dashed="true">
          <div className="qosp-form-grid" data-columns="2">
            <PortalField label={t("costAmount")} help={t("costAmountHelp")}>
              <input
                className="qos-input"
                dir="ltr"
                inputMode="decimal"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
            </PortalField>
            <PortalField label={t("costUnit")}>
              <select
                className="qos-input"
                value={form.unitPublicId}
                onChange={(event) => setForm({ ...form, unitPublicId: event.target.value })}
              >
                <option value="">{t("selectUnit")}</option>
                {costUnits.map((unit) => (
                  <option key={unit.publicId} value={unit.publicId}>
                    {unitLabel(unit.code, unit.nameEn, unit.nameAr)}
                  </option>
                ))}
              </select>
            </PortalField>
            <PortalField label={t("costTaxBasis")} help={t("costTaxBasisHelp")}>
              <select
                className="qos-input"
                value={form.taxBasis}
                onChange={(event) => setForm({ ...form, taxBasis: event.target.value as CostTaxBasis })}
              >
                {(Object.keys(TAX_BASIS_LABEL) as CostTaxBasis[]).map((basis) => (
                  <option key={basis} value={basis}>
                    {t(TAX_BASIS_LABEL[basis])}
                  </option>
                ))}
              </select>
            </PortalField>
            <PortalField label={t("costSource")}>
              <select
                className="qos-input"
                value={form.source}
                onChange={(event) => setForm({ ...form, source: event.target.value as CostSource })}
              >
                {(Object.keys(COST_SOURCE_LABEL) as CostSource[]).map((source) => (
                  <option key={source} value={source}>
                    {t(COST_SOURCE_LABEL[source])}
                  </option>
                ))}
              </select>
            </PortalField>
            <PortalField label={t("costSourceReference")}>
              <input
                className="qos-input"
                dir="auto"
                value={form.sourceReference}
                maxLength={200}
                onChange={(event) => setForm({ ...form, sourceReference: event.target.value })}
              />
            </PortalField>
            <PortalField label={t("costEffectiveFrom")} help={t("costEffectiveFromHelp")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={form.effectiveFrom}
                onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
              />
            </PortalField>
          </div>
          <div className="qosp-button-row qosp-inventory-actions">
            <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
              {t("saveCost")}
            </button>
            {current ? (
              <button
                type="button"
                className="qos-btn"
                data-variant="ghost"
                data-size="sm"
                disabled={busy}
                onClick={() => {
                  setClearError(null);
                  setClearing({ effectiveFrom: "" });
                }}
              >
                {t("clearCost")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {detail.costHistory.length > 0 ? (
        <details className="qosp-panel-body qosp-inventory-history">
          <summary>
            {t("costHistory")} · {staffCount(locale, "costVersions", detail.costHistory.length)}
          </summary>
          <p className="qosp-panel-help">{t("costHistoryHelp")}</p>
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("costHistory")}>
            {detail.costHistory.map((row) => (
              <HistoryRow key={row.publicId} row={row} />
            ))}
          </ul>
        </details>
      ) : null}

      <div className="qosp-panel-body">
        <h3 className="qosp-subcard-title">{t("costEvidenceTitle")}</h3>
        <p className="qosp-meta-line">{t("costEvidenceNone")}</p>
      </div>

      <Modal
        open={clearing !== null}
        size="sm"
        title={t("clearCost")}
        description={current ? <p className="qosp-inventory-sentence">{costLine(locale, current.amount, current.currency, current.unit.code)}</p> : null}
        onClose={() => setClearing(null)}
        footer={
          <>
            <button type="button" className="qos-btn" data-variant="secondary" onClick={() => setClearing(null)}>
              {t("cancel")}
            </button>
            <button type="button" className="qos-btn" data-variant="primary" disabled={busy} onClick={() => void clear()}>
              {t("clearCost")}
            </button>
          </>
        }
      >
        {clearing ? (
          <div className="qosp-stack">
            <p className="qosp-panel-help">{t("clearCostConfirm")}</p>
            <PortalField label={t("closeConversionDate")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={clearing.effectiveFrom}
                onChange={(event) => setClearing({ effectiveFrom: event.target.value })}
              />
            </PortalField>
          </div>
        ) : null}
        {clearError ? <PortalNotice tone="error">{clearError}</PortalNotice> : null}
      </Modal>
    </PortalPanel>
  );
}

/** Honest empty states: recipes and stock movements do not exist yet, so nothing is listed or simulated. */
export function ItemRelatedPanel() {
  const { locale } = useStaffLocale();
  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{staffUiCopy(locale, "relatedTitle")}</h2>
      <ul className="qosp-meta-line qosp-panel-body">
        <li>{staffUiCopy(locale, "relatedRecipesNone")}</li>
        <li>{staffUiCopy(locale, "relatedStockNone")}</li>
      </ul>
    </PortalPanel>
  );
}
