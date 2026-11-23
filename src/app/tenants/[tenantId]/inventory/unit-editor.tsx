"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  inventoryApi,
  inventoryFailureText,
  inventoryPath,
  QUANTITY_KIND_LABEL,
} from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { ConfirmDialog } from "@/components/Modal";
import { usePortalShell } from "@/components/portal/portal-shell-context";
import {
  PortalArea,
  PortalBadge,
  PortalField,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { UnitView } from "@/lib/inventory/shared";
import { QUANTITY_KINDS, type QuantityKind } from "@/lib/inventory/standard-units";
import type { StandardUnitView, UnitUsage } from "@/lib/inventory/units";
import { staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-195 unit editor. New units are either a standard unit from the
   constant table (names and precision prefilled) or a custom unit. On edit
   the code, kind and standard link are read-only; renames and precision
   changes keep the unit's identity. */

type Mode = "standard" | "custom" | "edit";

type Form = {
  standardCode: string;
  code: string;
  nameEn: string;
  nameAr: string;
  quantityKind: QuantityKind;
  decimalPlaces: string;
};

const EMPTY_FORM: Form = { standardCode: "", code: "", nameEn: "", nameAr: "", quantityKind: "pack", decimalPlaces: "0" };

export function UnitEditor({ tenantId, mode, unitPublicId }: { tenantId: string; mode: Mode; unitPublicId?: string }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [standardUnits, setStandardUnits] = useState<StandardUnitView[]>([]);
  const [unit, setUnit] = useState<UnitView | null>(null);
  const [usage, setUsage] = useState<UnitUsage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canEdit = branch.role === "administrator";

  const load = useCallback(async () => {
    if (mode === "edit") {
      const result = await inventoryApi<{ unit: UnitView; usage: UnitUsage }>(
        `/api/tenants/${tenantId}/inventory/units/${unitPublicId}`,
      );
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setUnit(result.data.unit);
      setUsage(result.data.usage);
      setForm({
        ...EMPTY_FORM,
        code: result.data.unit.code,
        nameEn: result.data.unit.nameEn,
        nameAr: result.data.unit.nameAr,
        quantityKind: result.data.unit.quantityKind,
        decimalPlaces: String(result.data.unit.decimalPlaces),
      });
    } else if (mode === "standard") {
      const result = await inventoryApi<{ standardUnits: StandardUnitView[] }>(`/api/tenants/${tenantId}/inventory/units`);
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setStandardUnits(result.data.standardUnits);
      const first = result.data.standardUnits.find((entry) => !entry.alreadyAdded);
      if (first) {
        setForm({
          ...EMPTY_FORM,
          standardCode: first.code,
          nameEn: first.nameEn,
          nameAr: first.nameAr,
          quantityKind: first.quantityKind,
          decimalPlaces: String(first.defaultDecimalPlaces),
        });
      }
    }
    setLoaded(true);
  }, [mode, tenantId, unitPublicId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function pickStandard(code: string) {
    const entry = standardUnits.find((candidate) => candidate.code === code);
    if (entry) {
      setForm({
        ...form,
        standardCode: entry.code,
        nameEn: entry.nameEn,
        nameAr: entry.nameAr,
        quantityKind: entry.quantityKind,
        decimalPlaces: String(entry.defaultDecimalPlaces),
      });
    }
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const decimalPlaces = Number.parseInt(form.decimalPlaces, 10);
    const result =
      mode === "edit"
        ? await inventoryApi<{ unit: UnitView }>(`/api/tenants/${tenantId}/inventory/units/${unitPublicId}`, {
            method: "PATCH",
            body: { expectedVersion: unit?.version, nameEn: form.nameEn, nameAr: form.nameAr, decimalPlaces },
          })
        : await inventoryApi<{ unit: UnitView }>(`/api/tenants/${tenantId}/inventory/units`, {
            method: "POST",
            body:
              mode === "standard"
                ? { source: "standard", standardCode: form.standardCode, nameEn: form.nameEn, nameAr: form.nameAr, decimalPlaces }
                : {
                    source: "custom",
                    code: form.code,
                    nameEn: form.nameEn,
                    nameAr: form.nameAr,
                    quantityKind: form.quantityKind,
                    decimalPlaces,
                  },
          });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    if (mode === "edit") {
      setUnit(result.data.unit);
      setNotice({ tone: "success", text: t("unitSaved") });
    } else {
      router.push(inventoryPath(tenantId, `/units/${result.data.unit.publicId}/edit`));
    }
  }

  async function setStatus(status: "active" | "archived") {
    setConfirmArchive(false);
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<{ unit: UnitView }>(`/api/tenants/${tenantId}/inventory/units/${unitPublicId}`, {
      method: "PATCH",
      body: { expectedVersion: unit?.version, status },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({
        tone: "error",
        text: result.code === "unit_in_use" ? t("unitInUse") : inventoryFailureText(locale, result),
      });
      return;
    }
    setUnit(result.data.unit);
    setNotice({ tone: "success", text: t("unitSaved") });
  }

  const title = mode === "edit" ? t("editUnit") : t(mode === "standard" ? "addStandardUnit" : "addCustomUnit");
  const available = standardUnits.filter((entry) => !entry.alreadyAdded);
  const readOnly = !canEdit;

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: `${inventoryPath(tenantId)}?tab=units`, label: t("inventoryBack") }}
        title={title}
        description={t(mode === "custom" ? "customUnitHelp" : "standardUnitHelp")}
      />
      <div className="qosp-stack">
        {branch.status === "ready" && readOnly ? <PortalNotice tone="info">{t("inventoryReadOnlyNote")}</PortalNotice> : null}
        {loadFailed ? (
          <PortalNotice tone="error">{t("inventoryLoadError")}</PortalNotice>
        ) : !loaded ? (
          <PortalPanel>
            <p className="qosp-meta-line" role="status">
              {t("inventoryLoading")}
            </p>
          </PortalPanel>
        ) : mode === "standard" && available.length === 0 ? (
          <PortalNotice tone="info">{t("allStandardUnitsAdded")}</PortalNotice>
        ) : (
          <PortalPanel>
            {unit ? (
              <div className="qosp-meta-row">
                <code className="qosp-code" dir="ltr">
                  {unit.code}
                </code>
                <PortalBadge tone={unit.standardCode ? "positive" : "neutral"}>
                  {t(unit.standardCode ? "standardUnitBadge" : "customUnitBadge")}
                </PortalBadge>
                <PortalBadge tone={unit.status === "active" ? "positive" : "danger"}>
                  {t(unit.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                </PortalBadge>
              </div>
            ) : null}
            <div className="qosp-form-grid" data-columns="2">
              {mode === "standard" ? (
                <PortalField label={t("standardUnitPicker")}>
                  <select
                    className="qos-input"
                    value={form.standardCode}
                    disabled={readOnly}
                    onChange={(event) => pickStandard(event.target.value)}
                  >
                    {available.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {`${entry.code} · ${locale === "ar" ? entry.nameAr : entry.nameEn}`}
                      </option>
                    ))}
                  </select>
                </PortalField>
              ) : null}
              {mode === "custom" ? (
                <PortalField label={t("unitCode")} help={t("unitCodeHelp")}>
                  <input
                    className="qos-input"
                    dir="ltr"
                    value={form.code}
                    maxLength={24}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, code: event.target.value })}
                  />
                </PortalField>
              ) : null}
              {mode === "edit" && unit ? (
                <PortalField label={t("unitCode")} help={t("unitCodeImmutable")}>
                  <span className="qosp-meta-line" dir="ltr">
                    {unit.code}
                  </span>
                </PortalField>
              ) : null}
              <PortalField label={t("unitNameEn")}>
                <input
                  className="qos-input"
                  dir="ltr"
                  value={form.nameEn}
                  maxLength={80}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
                />
              </PortalField>
              <PortalField label={t("unitNameAr")}>
                <input
                  className="qos-input"
                  dir="rtl"
                  lang="ar"
                  value={form.nameAr}
                  maxLength={80}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
                />
              </PortalField>
              <PortalField label={t("quantityKind")}>
                {mode === "custom" ? (
                  <select
                    className="qos-input"
                    value={form.quantityKind}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, quantityKind: event.target.value as QuantityKind })}
                  >
                    {QUANTITY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(QUANTITY_KIND_LABEL[kind])}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="qosp-meta-line">{t(QUANTITY_KIND_LABEL[form.quantityKind])}</span>
                )}
              </PortalField>
              <PortalField label={t("decimalPlaces")} help={t("decimalPlacesHelp")}>
                <select
                  className="qos-input"
                  value={form.decimalPlaces}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, decimalPlaces: event.target.value })}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((places) => (
                    <option key={places} value={String(places)}>
                      {places}
                    </option>
                  ))}
                </select>
              </PortalField>
            </div>
            {usage ? (
              <p className="qosp-meta-line">
                {staffCopyWith(locale, "unitUsage", {
                  items: staffCount(locale, "inventoryItems", usage.itemDesignations),
                  rules: staffCount(locale, "conversionRules", usage.currentRules),
                })}
              </p>
            ) : null}
            {unit?.status === "archived" ? <PortalNotice tone="warning">{t("unitArchivedNote")}</PortalNotice> : null}
            {notice ? <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice> : null}
            {canEdit ? (
              <div className="qosp-button-row qosp-inventory-actions">
                <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
                  {t("saveUnit")}
                </button>
                {unit ? (
                  unit.status === "active" ? (
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      disabled={busy}
                      onClick={() => setConfirmArchive(true)}
                    >
                      {t("archiveUnit")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      disabled={busy}
                      onClick={() => void setStatus("active")}
                    >
                      {t("restoreUnit")}
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </PortalPanel>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={t("archiveUnit")}
        description={t("archiveUnitConfirm")}
        confirmLabel={t("archiveUnit")}
        cancelLabel={t("cancel")}
        onConfirm={() => void setStatus("archived")}
        onClose={() => setConfirmArchive(false)}
      />
    </PortalArea>
  );
}
