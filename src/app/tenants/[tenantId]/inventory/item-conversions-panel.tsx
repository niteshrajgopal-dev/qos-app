"use client";

import { useState } from "react";

import { inventoryApi, inventoryFailureText } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { Modal } from "@/components/Modal";
import { PortalBadge, PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { ConversionView, ItemDetailView } from "@/lib/inventory/items";
import type { UnitView } from "@/lib/inventory/shared";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-195 item conversion rules. Each rule is scoped to this item. Changing
   a factor creates a new dated version and ending a rule closes it; neither
   rewrites the stored factor, and every version stays in the history. */

type AddForm = { fromUnitPublicId: string; toUnitPublicId: string; factor: string; justification: string; effectiveFrom: string };
type Dialog =
  | { kind: "revise"; rule: ConversionView; factor: string; justification: string; effectiveFrom: string }
  | { kind: "close"; rule: ConversionView; effectiveFrom: string }
  | null;

const EMPTY_ADD: AddForm = { fromUnitPublicId: "", toUnitPublicId: "", factor: "", justification: "", effectiveFrom: "" };

function isMassVolume(units: UnitView[], fromPublicId: string, toPublicId: string) {
  const kinds = new Set(
    units.filter((unit) => unit.publicId === fromPublicId || unit.publicId === toPublicId).map((unit) => unit.quantityKind),
  );
  return kinds.has("mass") && kinds.has("volume");
}

function ruleText(locale: StaffLocale, rule: ConversionView) {
  return staffCopyWith(locale, "conversionRule", {
    from: isolateText(rule.fromCode),
    factor: isolateText(rule.factor),
    to: isolateText(rule.toCode),
  });
}

function RuleMeta({ rule }: { rule: ConversionView }) {
  const { locale } = useStaffLocale();
  return (
    <div className="qosp-meta-row qosp-inventory-rule-meta">
      <span className="qosp-meta-line">
        {staffCopyWith(locale, "conversionEffectiveFrom", { date: isolateText(rule.effectiveFrom) })}
      </span>
      {rule.effectiveTo ? (
        <span className="qosp-meta-line">
          {staffCopyWith(locale, "conversionEffectiveTo", { date: isolateText(rule.effectiveTo) })}
        </span>
      ) : null}
      <span className="qosp-meta-line">
        {staffCopyWith(locale, "conversionRevision", { revision: isolateText(String(rule.revision)) })}
      </span>
      {rule.current ? <PortalBadge tone="positive">{staffUiCopy(locale, "conversionCurrent")}</PortalBadge> : null}
    </div>
  );
}

export function ItemConversionsPanel({
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
  const [add, setAdd] = useState<AddForm>(EMPTY_ADD);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/tenants/${tenantId}/inventory/items/${detail.item.publicId}/conversions`;
  const activeUnits = detail.units.filter((unit) => unit.status === "active");
  const unitLabel = (unit: UnitView) => `${unit.code} · ${locale === "ar" ? unit.nameAr : unit.nameEn}`;
  const addNeedsJustification = isMassVolume(detail.units, add.fromUnitPublicId, add.toUnitPublicId);

  async function submitAdd() {
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<ItemDetailView>(base, {
      method: "POST",
      body: {
        fromUnitPublicId: add.fromUnitPublicId,
        toUnitPublicId: add.toUnitPublicId,
        factor: add.factor,
        justification: addNeedsJustification ? add.justification : null,
        effectiveFrom: add.effectiveFrom || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    setAdd(EMPTY_ADD);
    setNotice({ tone: "success", text: t("conversionSaved") });
    onChange(result.data);
  }

  async function submitDialog() {
    if (!dialog) return;
    setBusy(true);
    setDialogError(null);
    const body =
      dialog.kind === "revise"
        ? {
            operation: "revise",
            expectedRevision: dialog.rule.revision,
            factor: dialog.factor,
            justification: dialog.justification || null,
            effectiveFrom: dialog.effectiveFrom || null,
          }
        : { operation: "close", expectedRevision: dialog.rule.revision, effectiveFrom: dialog.effectiveFrom || null };
    const result = await inventoryApi<ItemDetailView>(`${base}/${dialog.rule.publicId}`, { method: "PATCH", body });
    setBusy(false);
    if (!result.ok) {
      setDialogError(inventoryFailureText(locale, result));
      return;
    }
    setDialog(null);
    setNotice({ tone: "success", text: t("conversionSaved") });
    onChange(result.data);
  }

  const dialogNeedsJustification =
    dialog?.kind === "revise" && isMassVolume(detail.units, dialog.rule.fromUnitPublicId, dialog.rule.toUnitPublicId);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("conversionsTitle")}</h2>
      <p className="qosp-panel-help">
        {t("conversionsHelp")} {staffCount(locale, "conversionRules", detail.rules.length)}
      </p>

      {detail.rules.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("conversionsEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("conversionsTitle")}>
          {detail.rules.map((rule) => (
            <li key={rule.publicId} className="qosp-subcard qosp-inventory-rule">
              <p className="qosp-inventory-sentence">
                <bdi dir="ltr">{ruleText(locale, rule)}</bdi>
              </p>
              <RuleMeta rule={rule} />
              {rule.justification ? (
                <p className="qosp-meta-line">{staffCopyWith(locale, "conversionJustificationLine", { text: isolateText(rule.justification) })}</p>
              ) : null}
              {canEdit ? (
                <div className="qosp-button-row">
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    onClick={() => {
                      setDialogError(null);
                      setDialog({ kind: "revise", rule, factor: rule.factor, justification: rule.justification ?? "", effectiveFrom: "" });
                    }}
                  >
                    {t("reviseConversion")}
                  </button>
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="ghost"
                    data-size="sm"
                    onClick={() => {
                      setDialogError(null);
                      setDialog({ kind: "close", rule, effectiveFrom: "" });
                    }}
                  >
                    {t("closeConversion")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {notice ? (
        <div className="qosp-panel-body">
          <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
        </div>
      ) : null}

      {canEdit ? (
        <div className="qosp-panel-body qosp-subcard" data-dashed="true">
          <h3 className="qosp-subcard-title">{t("addConversion")}</h3>
          <div className="qosp-form-grid" data-columns="2">
            <PortalField label={t("fromUnit")}>
              <select
                className="qos-input"
                value={add.fromUnitPublicId}
                onChange={(event) => setAdd({ ...add, fromUnitPublicId: event.target.value })}
              >
                <option value="">{t("selectUnit")}</option>
                {activeUnits.map((unit) => (
                  <option key={unit.publicId} value={unit.publicId}>
                    {unitLabel(unit)}
                  </option>
                ))}
              </select>
            </PortalField>
            <PortalField label={t("toUnit")}>
              <select
                className="qos-input"
                value={add.toUnitPublicId}
                onChange={(event) => setAdd({ ...add, toUnitPublicId: event.target.value })}
              >
                <option value="">{t("selectUnit")}</option>
                {activeUnits.map((unit) => (
                  <option key={unit.publicId} value={unit.publicId}>
                    {unitLabel(unit)}
                  </option>
                ))}
              </select>
            </PortalField>
            <PortalField label={t("factor")} help={t("factorHelp")}>
              <input
                className="qos-input"
                dir="ltr"
                inputMode="decimal"
                value={add.factor}
                onChange={(event) => setAdd({ ...add, factor: event.target.value })}
              />
            </PortalField>
            <PortalField label={t("effectiveFrom")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={add.effectiveFrom}
                onChange={(event) => setAdd({ ...add, effectiveFrom: event.target.value })}
              />
            </PortalField>
            {addNeedsJustification ? (
              <PortalField label={t("justification")} help={t("justificationHelp")}>
                <input
                  className="qos-input"
                  value={add.justification}
                  maxLength={200}
                  onChange={(event) => setAdd({ ...add, justification: event.target.value })}
                />
              </PortalField>
            ) : null}
          </div>
          <div className="qosp-button-row qosp-inventory-actions">
            <button
              type="button"
              className="qos-btn"
              data-variant="primary"
              data-size="sm"
              disabled={busy || !add.fromUnitPublicId || !add.toUnitPublicId}
              onClick={() => void submitAdd()}
            >
              {t("addConversion")}
            </button>
          </div>
        </div>
      ) : null}

      {detail.history.length > 0 ? (
        <details className="qosp-panel-body qosp-inventory-history">
          <summary>
            {t("conversionHistory")} · {staffCount(locale, "conversionVersions", detail.history.length)}
          </summary>
          <p className="qosp-panel-help">{t("conversionHistoryHelp")}</p>
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("conversionHistory")}>
            {detail.history.map((rule) => (
              <li key={rule.publicId} className="qosp-subcard" data-muted={rule.current ? undefined : "true"}>
                <p className="qosp-inventory-sentence">
                <bdi dir="ltr">{ruleText(locale, rule)}</bdi>
              </p>
                <RuleMeta rule={rule} />
                {rule.justification ? (
                  <p className="qosp-meta-line">
                    {staffCopyWith(locale, "conversionJustificationLine", { text: isolateText(rule.justification) })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Modal
        open={dialog !== null}
        size="sm"
        title={dialog ? t(dialog.kind === "revise" ? "reviseConversion" : "closeConversion") : null}
        description={dialog ? <p className="qosp-inventory-sentence"><bdi dir="ltr">{ruleText(locale, dialog.rule)}</bdi></p> : null}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="qos-btn" data-variant="secondary" onClick={() => setDialog(null)}>
              {t("cancel")}
            </button>
            <button type="button" className="qos-btn" data-variant="primary" disabled={busy} onClick={() => void submitDialog()}>
              {t(dialog?.kind === "close" ? "closeConversion" : "saveConversionVersion")}
            </button>
          </>
        }
      >
        {dialog?.kind === "revise" ? (
          <div className="qosp-stack">
            <p className="qosp-panel-help">{t("reviseConversionHelp")}</p>
            <PortalField label={t("factor")} help={t("factorHelp")}>
              <input
                className="qos-input"
                dir="ltr"
                inputMode="decimal"
                value={dialog.factor}
                onChange={(event) => setDialog({ ...dialog, factor: event.target.value })}
              />
            </PortalField>
            {dialogNeedsJustification ? (
              <PortalField label={t("justification")} help={t("justificationHelp")}>
                <input
                  className="qos-input"
                  value={dialog.justification}
                  maxLength={200}
                  onChange={(event) => setDialog({ ...dialog, justification: event.target.value })}
                />
              </PortalField>
            ) : null}
            <PortalField label={t("effectiveFrom")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={dialog.effectiveFrom}
                onChange={(event) => setDialog({ ...dialog, effectiveFrom: event.target.value })}
              />
            </PortalField>
          </div>
        ) : dialog?.kind === "close" ? (
          <div className="qosp-stack">
            <p className="qosp-panel-help">{t("closeConversionConfirm")}</p>
            <PortalField label={t("closeConversionDate")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={dialog.effectiveFrom}
                onChange={(event) => setDialog({ ...dialog, effectiveFrom: event.target.value })}
              />
            </PortalField>
          </div>
        ) : null}
        {dialogError ? <PortalNotice tone="error">{dialogError}</PortalNotice> : null}
      </Modal>
    </PortalPanel>
  );
}
