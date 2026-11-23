"use client";

import Link from "next/link";
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
import type { SupplierView } from "@/lib/inventory/shared";
import type { SupplierDetailView } from "@/lib/inventory/suppliers";
import { staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-196 supplier screen: identity, contact and reference details, the
   items that use the supplier as their default, and archive / restore. A
   supplier with the same name as another is allowed and stays a separate
   supplier; the create form only points it out. */

type Form = {
  nameEn: string;
  nameAr: string;
  code: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

const EMPTY_FORM: Form = { nameEn: "", nameAr: "", code: "", contactName: "", phone: "", email: "", address: "", notes: "" };

function formFrom(supplier: SupplierView): Form {
  return {
    nameEn: supplier.nameEn,
    nameAr: supplier.nameAr ?? "",
    code: supplier.code ?? "",
    contactName: supplier.contactName ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    notes: supplier.notes ?? "",
  };
}

const orNull = (value: string) => (value.trim() ? value : null);

type Notice = { tone: "success" | "error"; text: string; dependencies?: Dependency[] };

export function SupplierEditorScreen({ tenantId, supplierPublicId }: { tenantId: string; supplierPublicId?: string }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [detail, setDetail] = useState<SupplierDetailView | null>(null);
  const [existing, setExisting] = useState<SupplierView[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canEdit = branch.role === "administrator";
  const readOnly = !canEdit;

  const applyDetail = useCallback((next: SupplierDetailView) => {
    setDetail(next);
    setForm(formFrom(next.supplier));
  }, []);

  const load = useCallback(async () => {
    if (supplierPublicId) {
      const result = await inventoryApi<SupplierDetailView>(`/api/tenants/${tenantId}/inventory/suppliers/${supplierPublicId}`);
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      applyDetail(result.data);
    } else {
      const result = await inventoryApi<{ suppliers: SupplierView[] }>(`/api/tenants/${tenantId}/inventory/suppliers`);
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setExisting(result.data.suppliers);
    }
    setLoaded(true);
  }, [applyDetail, supplierPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    setBusy(true);
    setNotice(null);
    const body = {
      nameEn: form.nameEn,
      nameAr: orNull(form.nameAr),
      code: orNull(form.code),
      contactName: orNull(form.contactName),
      phone: orNull(form.phone),
      email: orNull(form.email),
      address: orNull(form.address),
      notes: orNull(form.notes),
    };
    const result = detail
      ? await inventoryApi<SupplierDetailView>(`/api/tenants/${tenantId}/inventory/suppliers/${detail.supplier.publicId}`, {
          method: "PATCH",
          body: { ...body, expectedVersion: detail.supplier.version },
        })
      : await inventoryApi<{ supplier: SupplierDetailView }>(`/api/tenants/${tenantId}/inventory/suppliers`, {
          method: "POST",
          body,
        });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    if (detail) {
      applyDetail(result.data as SupplierDetailView);
      setNotice({ tone: "success", text: t("supplierSaved") });
    } else {
      const created = (result.data as { supplier: SupplierDetailView }).supplier;
      router.push(inventoryPath(tenantId, `/suppliers/${created.supplier.publicId}`));
    }
  }

  async function setStatus(status: "active" | "archived") {
    setConfirmArchive(false);
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<SupplierDetailView>(
      `/api/tenants/${tenantId}/inventory/suppliers/${detail.supplier.publicId}`,
      { method: "PATCH", body: { expectedVersion: detail.supplier.version, status } },
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    applyDetail(result.data);
    setNotice({ tone: "success", text: t("supplierSaved") });
  }

  const heading = detail ? localName(locale, detail.supplier.nameEn, detail.supplier.nameAr) : null;
  const typedName = form.nameEn.trim().toLowerCase();
  const duplicateName =
    !detail && typedName !== "" && existing.some((supplier) => supplier.nameEn.trim().toLowerCase() === typedName);
  const field = (key: keyof Form, props: { dir?: "ltr" | "rtl"; lang?: string; inputMode?: "tel" | "email"; maxLength: number }) => (
    <input
      className="qos-input"
      value={form[key]}
      disabled={readOnly}
      {...props}
      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
    />
  );

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: `${inventoryPath(tenantId)}?tab=suppliers`, label: t("inventoryBack") }}
        title={heading ? <span dir={heading.dir}>{heading.text}</span> : t(supplierPublicId ? "inventoryLoading" : "newSupplierTitle")}
        description={t("supplierContactHelp")}
        meta={<span className="qosp-meta-line">{t("supplierReceiptsUnavailable")}</span>}
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
          <>
            <PortalPanel>
              {detail ? (
                <div className="qosp-meta-row">
                  <PortalBadge tone={detail.supplier.status === "active" ? "positive" : "danger"}>
                    {t(detail.supplier.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
                </div>
              ) : null}
              <div className="qosp-form-grid" data-columns="2">
                <PortalField label={t("itemNameEn")}>{field("nameEn", { dir: "ltr", maxLength: 120 })}</PortalField>
                <PortalField label={t("itemNameAr")}>{field("nameAr", { dir: "rtl", lang: "ar", maxLength: 120 })}</PortalField>
                <PortalField label={t("supplierCode")} help={t("supplierCodeHelp")}>
                  {field("code", { dir: "ltr", maxLength: 24 })}
                </PortalField>
                <PortalField label={t("supplierContactName")}>{field("contactName", { maxLength: 120 })}</PortalField>
                <PortalField label={t("supplierPhone")}>{field("phone", { dir: "ltr", inputMode: "tel", maxLength: 40 })}</PortalField>
                <PortalField label={t("supplierEmail")}>
                  {field("email", { dir: "ltr", inputMode: "email", maxLength: 254 })}
                </PortalField>
                <PortalField label={t("supplierAddress")}>
                  <textarea
                    className="qos-textarea"
                    rows={3}
                    value={form.address}
                    maxLength={400}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, address: event.target.value })}
                  />
                </PortalField>
                <PortalField label={t("inventoryNotes")}>
                  <textarea
                    className="qos-textarea"
                    rows={3}
                    value={form.notes}
                    maxLength={1000}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </PortalField>
              </div>
              {duplicateName ? <PortalNotice tone="info">{t("supplierDuplicateNameNote")}</PortalNotice> : null}
              {detail?.supplier.status === "archived" ? (
                <PortalNotice tone="warning">{t("supplierArchivedNote")}</PortalNotice>
              ) : null}
              {notice?.dependencies ? (
                <DependencyNotice message={notice.text} dependencies={notice.dependencies} />
              ) : notice ? (
                <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
              ) : null}
              {canEdit ? (
                <div className="qosp-button-row qosp-inventory-actions">
                  <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
                    {t("saveSupplier")}
                  </button>
                  {detail ? (
                    detail.supplier.status === "active" ? (
                      <button
                        type="button"
                        className="qos-btn"
                        data-variant="secondary"
                        data-size="sm"
                        disabled={busy}
                        onClick={() => setConfirmArchive(true)}
                      >
                        {t("archiveSupplier")}
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
                        {t("restoreSupplier")}
                      </button>
                    )
                  ) : null}
                </div>
              ) : null}
            </PortalPanel>
            {detail ? <SupplierItemsPanel tenantId={tenantId} detail={detail} /> : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={t("archiveSupplier")}
        description={t("archiveSupplierConfirm")}
        confirmLabel={t("archiveSupplier")}
        cancelLabel={t("cancel")}
        onConfirm={() => void setStatus("archived")}
        onClose={() => setConfirmArchive(false)}
      />
    </PortalArea>
  );
}

function SupplierItemsPanel({ tenantId, detail }: { tenantId: string; detail: SupplierDetailView }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("supplierItemsTitle")}</h2>
      <p className="qosp-panel-help">
        {staffCount(locale, "supplierItems", detail.items.length)}. {t("supplierItemsHelp")}
      </p>
      {detail.items.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("supplierItemsEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("supplierItemsTitle")}>
          {detail.items.map((item) => {
            const name = localName(locale, item.nameEn, item.nameAr);
            return (
              <li key={item.publicId} className="qosp-branch-row qosp-subcard">
                <div className="qosp-branch-row-main">
                  <strong className="qosp-branch-row-name" dir={name.dir}>
                    {name.text}
                  </strong>
                  <span>{t(item.kind === "prepared" ? "itemKindPrepared" : "itemKindPurchased")}</span>
                </div>
                <div className="qosp-branch-row-status">
                  {item.status === "archived" ? <PortalBadge tone="neutral">{t("inventoryStatusArchived")}</PortalBadge> : null}
                </div>
                <div className="qosp-branch-row-status">
                  <Link
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    href={inventoryPath(tenantId, `/items/${item.publicId}`)}
                  >
                    {t("openItem")}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PortalPanel>
  );
}
