"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ConversionPreviewPanel } from "@/app/tenants/[tenantId]/inventory/conversion-preview-panel";
import { DependencyNotice } from "@/app/tenants/[tenantId]/inventory/dependency-notice";
import {
  inventoryApi,
  inventoryFailureText,
  inventoryPath,
  localName,
} from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { ItemConversionsPanel } from "@/app/tenants/[tenantId]/inventory/item-conversions-panel";
import { ItemCostPanel, ItemRelatedPanel } from "@/app/tenants/[tenantId]/inventory/item-cost-panel";
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
import type { InventoryItemKind, ItemDetailView } from "@/lib/inventory/items";
import type { CategoryView, SupplierView, UnitView } from "@/lib/inventory/shared";
import { staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-195 item screen: names, kind and the storage / recipe / purchase unit
   designations, then the item's own conversion rules, the preview that
   explains its quantities and the dated history. A rename keeps the item's
   public id and every rule. QOS-196 adds the default supplier; QOS-197 the
   category, notes, the reference cost panel and the related recipes and stock
   empty states. QOS-198 lists real recipe usage there and explains a refused
   archive or kind change with the recipes and links that block it. */

type Form = {
  nameEn: string;
  nameAr: string;
  kind: InventoryItemKind;
  storageUnitPublicId: string;
  recipeUnitPublicId: string;
  purchaseUnitPublicId: string;
  defaultSupplierPublicId: string;
  categoryPublicId: string;
  notes: string;
};

const EMPTY_FORM: Form = {
  nameEn: "",
  nameAr: "",
  kind: "purchased",
  storageUnitPublicId: "",
  recipeUnitPublicId: "",
  purchaseUnitPublicId: "",
  defaultSupplierPublicId: "",
  categoryPublicId: "",
  notes: "",
};

function formFrom(detail: ItemDetailView): Form {
  return {
    nameEn: detail.item.nameEn,
    nameAr: detail.item.nameAr ?? "",
    kind: detail.item.kind,
    storageUnitPublicId: detail.item.storageUnitPublicId ?? "",
    recipeUnitPublicId: detail.item.recipeUnitPublicId ?? "",
    purchaseUnitPublicId: detail.item.purchaseUnitPublicId ?? "",
    defaultSupplierPublicId: detail.item.defaultSupplierPublicId ?? "",
    categoryPublicId: detail.item.categoryPublicId ?? "",
    notes: detail.item.notes ?? "",
  };
}

const DESIGNATIONS = [
  { key: "storageUnitPublicId", label: "storageUnit" },
  { key: "recipeUnitPublicId", label: "recipeUnit" },
  { key: "purchaseUnitPublicId", label: "purchaseUnit" },
] as const;

export function ItemEditorScreen({ tenantId, itemPublicId }: { tenantId: string; itemPublicId?: string }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [detail, setDetail] = useState<ItemDetailView | null>(null);
  const [units, setUnits] = useState<UnitView[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierView[]>([]);
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; dependencies?: Dependency[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canEdit = branch.role === "administrator";

  const applyDetail = useCallback((next: ItemDetailView) => {
    setDetail(next);
    setUnits(next.units);
    setSuppliers(next.suppliers);
    setCategories(next.categories);
    setForm(formFrom(next));
  }, []);

  const load = useCallback(async () => {
    if (itemPublicId) {
      const result = await inventoryApi<ItemDetailView>(`/api/tenants/${tenantId}/inventory/items/${itemPublicId}`);
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      applyDetail(result.data);
    } else {
      const [result, supplierList, categoryList] = await Promise.all([
        inventoryApi<{ units: UnitView[] }>(`/api/tenants/${tenantId}/inventory/units`),
        inventoryApi<{ suppliers: SupplierView[] }>(`/api/tenants/${tenantId}/inventory/suppliers`),
        inventoryApi<{ categories: CategoryView[] }>(`/api/tenants/${tenantId}/inventory/categories`),
      ]);
      if (!result.ok || !supplierList.ok || !categoryList.ok) {
        setLoadFailed(true);
        return;
      }
      setUnits(result.data.units.filter((unit) => unit.status === "active"));
      setSuppliers(supplierList.data.suppliers.filter((supplier) => supplier.status === "active"));
      setCategories(categoryList.data.categories.filter((category) => category.status === "active"));
    }
    setLoaded(true);
  }, [applyDetail, itemPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    setBusy(true);
    setNotice(null);
    const body = {
      nameEn: form.nameEn,
      nameAr: form.nameAr.trim() ? form.nameAr : null,
      kind: form.kind,
      storageUnitPublicId: form.storageUnitPublicId || null,
      recipeUnitPublicId: form.recipeUnitPublicId || null,
      purchaseUnitPublicId: form.purchaseUnitPublicId || null,
      defaultSupplierPublicId: form.defaultSupplierPublicId || null,
      categoryPublicId: form.categoryPublicId || null,
      notes: form.notes.trim() ? form.notes : null,
    };
    const result = detail
      ? await inventoryApi<ItemDetailView>(`/api/tenants/${tenantId}/inventory/items/${detail.item.publicId}`, {
          method: "PATCH",
          body: { ...body, expectedVersion: detail.item.version },
        })
      : await inventoryApi<{ item: ItemDetailView }>(`/api/tenants/${tenantId}/inventory/items`, { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    if (detail) {
      applyDetail(result.data as ItemDetailView);
      setNotice({ tone: "success", text: t("itemSaved") });
    } else {
      router.push(inventoryPath(tenantId, `/items/${(result.data as { item: ItemDetailView }).item.item.publicId}`));
    }
  }

  async function setStatus(status: "active" | "archived") {
    setConfirmArchive(false);
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<ItemDetailView>(`/api/tenants/${tenantId}/inventory/items/${detail.item.publicId}`, {
      method: "PATCH",
      body: { expectedVersion: detail.item.version, status },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    applyDetail(result.data);
    setNotice({ tone: "success", text: t("itemSaved") });
  }

  const heading = detail ? localName(locale, detail.item.nameEn, detail.item.nameAr) : null;
  const unitLabel = (unit: UnitView) => `${unit.code} · ${locale === "ar" ? unit.nameAr : unit.nameEn}`;
  const supplierLabel = (supplier: SupplierView) => {
    const name = locale === "ar" && supplier.nameAr ? supplier.nameAr : supplier.nameEn;
    return supplier.code ? `${name} · ${supplier.code}` : name;
  };
  const categoryLabel = (category: CategoryView) => {
    const name = locale === "ar" && category.nameAr ? category.nameAr : category.nameEn;
    return category.status === "archived" ? `${name} · ${t("inventoryStatusArchived")}` : name;
  };
  const readOnly = !canEdit;

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: inventoryPath(tenantId), label: t("inventoryBack") }}
        title={heading ? <span dir={heading.dir}>{heading.text}</span> : t(itemPublicId ? "inventoryLoading" : "newItemTitle")}
        description={t("conversionsHelp")}
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
                  <PortalBadge tone={detail.item.status === "active" ? "positive" : "danger"}>
                    {t(detail.item.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
                  {detail.preview.status === "none" ? null : (
                    <PortalBadge tone={detail.preview.status === "complete" ? "positive" : "warm"} wrap>
                      {t(detail.preview.status === "complete" ? "previewComplete" : "previewIncomplete")}
                    </PortalBadge>
                  )}
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
                <PortalField label={t("itemKind")} help={t("itemKindHelp")}>
                  <select
                    className="qos-input"
                    value={form.kind}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, kind: event.target.value as InventoryItemKind })}
                  >
                    <option value="purchased">{t("itemKindPurchased")}</option>
                    <option value="prepared">{t("itemKindPrepared")}</option>
                  </select>
                </PortalField>
                {DESIGNATIONS.map(({ key, label }) => (
                  <PortalField key={key} label={t(label)}>
                    <select
                      className="qos-input"
                      value={form[key]}
                      disabled={readOnly}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    >
                      <option value="">{t("unitNotSet")}</option>
                      {units.map((unit) => (
                        <option key={unit.publicId} value={unit.publicId}>
                          {unitLabel(unit)}
                        </option>
                      ))}
                    </select>
                  </PortalField>
                ))}
                <PortalField label={t("itemCategory")}>
                  <select
                    className="qos-input"
                    value={form.categoryPublicId}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, categoryPublicId: event.target.value })}
                  >
                    <option value="">{t("itemCategoryNone")}</option>
                    {categories.map((category) => (
                      <option key={category.publicId} value={category.publicId}>
                        {categoryLabel(category)}
                      </option>
                    ))}
                  </select>
                </PortalField>
                <PortalField label={t("defaultSupplier")} help={t("defaultSupplierHelp")}>
                  <select
                    className="qos-input"
                    value={form.defaultSupplierPublicId}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, defaultSupplierPublicId: event.target.value })}
                  >
                    <option value="">{t("unitNotSet")}</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.publicId} value={supplier.publicId}>
                        {supplier.status === "archived"
                          ? `${supplierLabel(supplier)} · ${t("inventoryStatusArchived")}`
                          : supplierLabel(supplier)}
                      </option>
                    ))}
                  </select>
                </PortalField>
                <PortalField label={t("inventoryNotes")} help={t("itemNotesHelp")}>
                  <textarea
                    className="qos-textarea"
                    dir="auto"
                    rows={3}
                    value={form.notes}
                    maxLength={1000}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </PortalField>
              </div>
              {detail?.item.status === "archived" ? <PortalNotice tone="warning">{t("itemArchivedNote")}</PortalNotice> : null}
              {notice?.dependencies?.length ? (
                <DependencyNotice message={notice.text} dependencies={notice.dependencies} />
              ) : notice ? (
                <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
              ) : null}
              {canEdit ? (
                <div className="qosp-button-row qosp-inventory-actions">
                  <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
                    {t("saveItem")}
                  </button>
                  {detail ? (
                    detail.item.status === "active" ? (
                      <button
                        type="button"
                        className="qos-btn"
                        data-variant="secondary"
                        data-size="sm"
                        disabled={busy}
                        onClick={() => setConfirmArchive(true)}
                      >
                        {t("archiveItem")}
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
                        {t("restoreItem")}
                      </button>
                    )
                  ) : null}
                </div>
              ) : null}
            </PortalPanel>
            {detail ? (
              <>
                <ConversionPreviewPanel preview={detail.preview} />
                <ItemConversionsPanel
                  tenantId={tenantId}
                  detail={detail}
                  canEdit={canEdit && detail.item.status === "active"}
                  onChange={applyDetail}
                />
                <ItemCostPanel
                  key={detail.item.version}
                  tenantId={tenantId}
                  detail={detail}
                  canEdit={canEdit && detail.item.status === "active"}
                  onChange={applyDetail}
                />
                <ItemRelatedPanel tenantId={tenantId} usage={detail.usage} />
              </>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={t("archiveItem")}
        description={t("archiveItemConfirm")}
        confirmLabel={t("archiveItem")}
        cancelLabel={t("cancel")}
        onConfirm={() => void setStatus("archived")}
        onClose={() => setConfirmArchive(false)}
      />
    </PortalArea>
  );
}
