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
import type { CategoryDetailView } from "@/lib/inventory/categories";
import type { Dependency } from "@/lib/inventory/errors";
import { staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-197 inventory category screen: English and Arabic names, the items in
   the category, and archive / restore. A rename keeps the category's public
   id, so every item stays in it. Archiving is refused while active items are
   in the category; the refusal lists how many. */

type Form = { nameEn: string; nameAr: string };

const EMPTY_FORM: Form = { nameEn: "", nameAr: "" };

type Notice = { tone: "success" | "error"; text: string; dependencies?: Dependency[] };

export function CategoryEditorScreen({ tenantId, categoryPublicId }: { tenantId: string; categoryPublicId?: string }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [detail, setDetail] = useState<CategoryDetailView | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(!categoryPublicId);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canEdit = branch.role === "administrator";
  const readOnly = !canEdit;

  const applyDetail = useCallback((next: CategoryDetailView) => {
    setDetail(next);
    setForm({ nameEn: next.category.nameEn, nameAr: next.category.nameAr ?? "" });
  }, []);

  const load = useCallback(async () => {
    if (!categoryPublicId) return;
    const result = await inventoryApi<CategoryDetailView>(`/api/tenants/${tenantId}/inventory/categories/${categoryPublicId}`);
    if (!result.ok) {
      setLoadFailed(true);
      return;
    }
    applyDetail(result.data);
    setLoaded(true);
  }, [applyDetail, categoryPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    setBusy(true);
    setNotice(null);
    const body = { nameEn: form.nameEn, nameAr: form.nameAr.trim() ? form.nameAr : null };
    const result = detail
      ? await inventoryApi<CategoryDetailView>(`/api/tenants/${tenantId}/inventory/categories/${detail.category.publicId}`, {
          method: "PATCH",
          body: { ...body, expectedVersion: detail.category.version },
        })
      : await inventoryApi<{ category: CategoryDetailView }>(`/api/tenants/${tenantId}/inventory/categories`, {
          method: "POST",
          body,
        });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    if (detail) {
      applyDetail(result.data as CategoryDetailView);
      setNotice({ tone: "success", text: t("categorySaved") });
    } else {
      const created = (result.data as { category: CategoryDetailView }).category;
      router.push(inventoryPath(tenantId, `/categories/${created.category.publicId}`));
    }
  }

  async function setStatus(status: "active" | "archived") {
    setConfirmArchive(false);
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<CategoryDetailView>(
      `/api/tenants/${tenantId}/inventory/categories/${detail.category.publicId}`,
      { method: "PATCH", body: { expectedVersion: detail.category.version, status } },
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    applyDetail(result.data);
    setNotice({ tone: "success", text: t("categorySaved") });
  }

  const heading = detail ? localName(locale, detail.category.nameEn, detail.category.nameAr) : null;

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: `${inventoryPath(tenantId)}?tab=categories`, label: t("inventoryBack") }}
        title={heading ? <span dir={heading.dir}>{heading.text}</span> : t(categoryPublicId ? "inventoryLoading" : "newCategoryTitle")}
        description={t("categoryHelp")}
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
                  <PortalBadge tone={detail.category.status === "active" ? "positive" : "danger"}>
                    {t(detail.category.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
                </div>
              ) : null}
              <div className="qosp-form-grid" data-columns="2">
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
              </div>
              {detail?.category.status === "archived" || notice ? (
                <div className="qosp-stack qosp-inventory-notices">
                  {detail?.category.status === "archived" ? (
                    <PortalNotice tone="warning">{t("categoryArchivedNote")}</PortalNotice>
                  ) : null}
                  {notice?.dependencies ? (
                    <DependencyNotice message={notice.text} dependencies={notice.dependencies} itemsCountKey="categoryItems" />
                  ) : notice ? (
                    <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
                  ) : null}
                </div>
              ) : null}
              {canEdit ? (
                <div className="qosp-button-row qosp-inventory-actions">
                  <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
                    {t("saveCategory")}
                  </button>
                  {detail ? (
                    detail.category.status === "active" ? (
                      <button
                        type="button"
                        className="qos-btn"
                        data-variant="secondary"
                        data-size="sm"
                        disabled={busy}
                        onClick={() => setConfirmArchive(true)}
                      >
                        {t("archiveCategory")}
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
                        {t("restoreCategory")}
                      </button>
                    )
                  ) : null}
                </div>
              ) : null}
            </PortalPanel>
            {detail ? <CategoryItemsPanel tenantId={tenantId} detail={detail} /> : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={t("archiveCategory")}
        description={t("archiveCategoryConfirm")}
        confirmLabel={t("archiveCategory")}
        cancelLabel={t("cancel")}
        onConfirm={() => void setStatus("archived")}
        onClose={() => setConfirmArchive(false)}
      />
    </PortalArea>
  );
}

function CategoryItemsPanel({ tenantId, detail }: { tenantId: string; detail: CategoryDetailView }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("categoryItemsTitle")}</h2>
      <p className="qosp-panel-help">
        {staffCount(locale, "inventoryItems", detail.items.length)}. {t("categoryItemsHelp")}
      </p>
      {detail.items.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("categoryItemsEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("categoryItemsTitle")}>
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
                  <PortalBadge tone={item.status === "active" ? "positive" : "neutral"}>
                    {t(item.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
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
