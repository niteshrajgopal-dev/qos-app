"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DependencyNotice } from "@/app/tenants/[tenantId]/inventory/dependency-notice";
import {
  inventoryApi,
  inventoryFailureText,
  inventoryPath,
  localName,
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
import type { Dependency } from "@/lib/inventory/errors";
import type { WarehouseDetailView, WarehouseView } from "@/lib/inventory/warehouses";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-196 warehouse screen. On create the branch list is the shell's real
   locations (never All Branches or the unconfirmed business labels), limited
   to active branches without an active warehouse; the server enforces the
   same rules. After create the branch and code are fixed and shown as text. */

type Form = { locationPublicId: string; code: string; nameEn: string; nameAr: string; notes: string };

const EMPTY_FORM: Form = { locationPublicId: "", code: "", nameEn: "", nameAr: "", notes: "" };

type Notice = { tone: "success" | "error"; text: string; dependencies?: Dependency[] };

export function WarehouseEditorScreen({ tenantId, warehousePublicId }: { tenantId: string; warehousePublicId?: string }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [detail, setDetail] = useState<WarehouseDetailView | null>(null);
  const [existing, setExisting] = useState<WarehouseView[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canEdit = branch.role === "administrator";
  const readOnly = !canEdit;

  const applyDetail = useCallback((next: WarehouseDetailView) => {
    setDetail(next);
    setForm({
      locationPublicId: next.warehouse.branch.publicId,
      code: next.warehouse.code,
      nameEn: next.warehouse.nameEn,
      nameAr: next.warehouse.nameAr ?? "",
      notes: next.warehouse.notes ?? "",
    });
  }, []);

  const load = useCallback(async () => {
    if (warehousePublicId) {
      const result = await inventoryApi<WarehouseDetailView>(
        `/api/tenants/${tenantId}/inventory/warehouses/${warehousePublicId}`,
      );
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      applyDetail(result.data);
    } else {
      const result = await inventoryApi<{ warehouses: WarehouseView[] }>(`/api/tenants/${tenantId}/inventory/warehouses`);
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setExisting(result.data.warehouses);
    }
    setLoaded(true);
  }, [applyDetail, tenantId, warehousePublicId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Client convenience only: the server refuses a suspended branch or a second active warehouse.
  const taken = new Set(existing.filter((warehouse) => warehouse.status === "active").map((warehouse) => warehouse.branch.publicId));
  const availableBranches = branch.branches.filter((option) => option.status === "active" && !taken.has(option.publicId));
  const selectedLocation = form.locationPublicId || availableBranches[0]?.publicId || "";

  async function save() {
    setBusy(true);
    setNotice(null);
    const names = { nameEn: form.nameEn, nameAr: form.nameAr.trim() ? form.nameAr : null, notes: form.notes.trim() ? form.notes : null };
    const result = detail
      ? await inventoryApi<WarehouseDetailView>(`/api/tenants/${tenantId}/inventory/warehouses/${detail.warehouse.publicId}`, {
          method: "PATCH",
          body: { ...names, expectedVersion: detail.warehouse.version },
        })
      : await inventoryApi<{ warehouse: WarehouseDetailView }>(`/api/tenants/${tenantId}/inventory/warehouses`, {
          method: "POST",
          body: { ...names, locationPublicId: selectedLocation, code: form.code },
        });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    if (detail) {
      applyDetail(result.data as WarehouseDetailView);
      setNotice({ tone: "success", text: t("warehouseSaved") });
    } else {
      const created = (result.data as { warehouse: WarehouseDetailView }).warehouse;
      router.push(inventoryPath(tenantId, `/warehouses/${created.warehouse.publicId}`));
    }
  }

  async function setStatus(status: "active" | "archived") {
    setConfirmArchive(false);
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<WarehouseDetailView>(
      `/api/tenants/${tenantId}/inventory/warehouses/${detail.warehouse.publicId}`,
      { method: "PATCH", body: { expectedVersion: detail.warehouse.version, status } },
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    applyDetail(result.data);
    setNotice({ tone: "success", text: t("warehouseSaved") });
  }

  const heading = detail ? localName(locale, detail.warehouse.nameEn, detail.warehouse.nameAr) : null;
  const noBranch = !detail && availableBranches.length === 0;

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: `${inventoryPath(tenantId)}?tab=warehouses`, label: t("inventoryBack") }}
        title={heading ? <span dir={heading.dir}>{heading.text}</span> : t(warehousePublicId ? "inventoryLoading" : "newWarehouseTitle")}
        description={t("warehouseBranchHelp")}
        meta={detail && detail.dependencies.length === 0 ? <span className="qosp-meta-line">{t("warehouseNoHistory")}</span> : null}
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
        ) : (
          <PortalPanel>
            {detail ? (
              <div className="qosp-meta-row">
                <PortalBadge tone={detail.warehouse.status === "active" ? "positive" : "danger"}>
                  {t(detail.warehouse.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                </PortalBadge>
                {detail.warehouse.branch.status === "suspended" ? (
                  <PortalBadge tone="warm">{t("branchStatusSuspended")}</PortalBadge>
                ) : null}
              </div>
            ) : null}
            {noBranch ? <PortalNotice tone="info">{t("warehouseNoBranchAvailable")}</PortalNotice> : null}
            <div className="qosp-form-grid" data-columns="2">
              <PortalField label={t("warehouseBranch")}>
                {detail ? (
                  <span className="qos-input" aria-readonly="true">
                    <bdi>{detail.warehouse.branch.name}</bdi>
                  </span>
                ) : (
                  <select
                    className="qos-input"
                    value={selectedLocation}
                    disabled={readOnly || noBranch}
                    onChange={(event) => setForm({ ...form, locationPublicId: event.target.value })}
                  >
                    {availableBranches.map((option) => (
                      <option key={option.publicId} value={option.publicId}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                )}
              </PortalField>
              <PortalField label={t("warehouseCode")} help={t("warehouseCodeHelp")}>
                <input
                  className="qos-input"
                  dir="ltr"
                  value={form.code}
                  maxLength={24}
                  readOnly={Boolean(detail)}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </PortalField>
              <PortalField label={t("itemNameEn")}>
                <input
                  className="qos-input"
                  dir="ltr"
                  value={form.nameEn}
                  maxLength={120}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
                />
              </PortalField>
              <PortalField label={t("itemNameAr")}>
                <input
                  className="qos-input"
                  dir="rtl"
                  lang="ar"
                  value={form.nameAr}
                  maxLength={120}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
                />
              </PortalField>
              <PortalField label={t("inventoryNotes")}>
                <textarea
                  className="qos-textarea"
                  rows={3}
                  value={form.notes}
                  maxLength={400}
                  disabled={readOnly}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </PortalField>
            </div>
            {detail ? (
              <p className="qosp-meta-line">
                {staffCopyWith(locale, "warehouseBranchFixedNote", { branch: detail.warehouse.branch.name })}
              </p>
            ) : null}
            {detail?.warehouse.branch.status === "suspended" ? (
              <PortalNotice tone="warning">{t("warehouseBranchSuspendedNote")}</PortalNotice>
            ) : null}
            {detail?.warehouse.status === "archived" ? (
              <PortalNotice tone="warning">{t("warehouseArchivedNote")}</PortalNotice>
            ) : null}
            {notice?.dependencies ? (
              <DependencyNotice message={notice.text} dependencies={notice.dependencies} />
            ) : notice ? (
              <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
            ) : null}
            {canEdit ? (
              <div className="qosp-button-row qosp-inventory-actions">
                <button
                  type="button"
                  className="qos-btn"
                  data-variant="primary"
                  data-size="sm"
                  disabled={busy || noBranch}
                  onClick={() => void save()}
                >
                  {t("saveWarehouse")}
                </button>
                {detail ? (
                  detail.warehouse.status === "active" ? (
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      disabled={busy}
                      onClick={() => setConfirmArchive(true)}
                    >
                      {t("archiveWarehouse")}
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
                      {t("restoreWarehouse")}
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
        title={t("archiveWarehouse")}
        description={t("archiveWarehouseConfirm")}
        confirmLabel={t("archiveWarehouse")}
        cancelLabel={t("cancel")}
        onConfirm={() => void setStatus("archived")}
        onClose={() => setConfirmArchive(false)}
      />
    </PortalArea>
  );
}
