"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  inventoryApi,
  inventoryPath,
  localName,
  QUANTITY_KIND_LABEL,
} from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { type InventoryTab, inventoryTabFrom } from "@/app/tenants/[tenantId]/inventory/inventory-tabs";
import { usePortalShell } from "@/components/portal/portal-shell-context";
import {
  PortalArea,
  PortalBadge,
  PortalFilterTabs,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { ItemSummaryView } from "@/lib/inventory/items";
import type { SupplierView, UnitView } from "@/lib/inventory/shared";
import type { WarehouseView } from "@/lib/inventory/warehouses";
import { staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* Inventory > Ingredients and stock (QOS-195): tenant-wide units and items,
   plus suppliers and branch warehouses (QOS-196). Lists come from the
   inventory API; administrators get the add actions for the open tab, other
   members a read-only notice. Stock levels, categories and costs are later
   leaves and are named, not simulated. */

type Loaded = { items: ItemSummaryView[]; units: UnitView[]; suppliers: SupplierView[]; warehouses: WarehouseView[] };

export function InventoryScreen({ tenantId, initialTab }: { tenantId: string; initialTab: InventoryTab }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [tab, setTab] = useState<InventoryTab>(initialTab);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const isAdministrator = branch.role === "administrator";

  const load = useCallback(async () => {
    const [items, units, suppliers, warehouses] = await Promise.all([
      inventoryApi<{ items: ItemSummaryView[] }>(`/api/tenants/${tenantId}/inventory/items`),
      inventoryApi<{ units: UnitView[] }>(`/api/tenants/${tenantId}/inventory/units`),
      inventoryApi<{ suppliers: SupplierView[] }>(`/api/tenants/${tenantId}/inventory/suppliers`),
      inventoryApi<{ warehouses: WarehouseView[] }>(`/api/tenants/${tenantId}/inventory/warehouses`),
    ]);
    if (!items.ok || !units.ok || !suppliers.ok || !warehouses.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData({
      items: items.data.items,
      units: units.data.units,
      suppliers: suppliers.data.suppliers,
      warehouses: warehouses.data.warehouses,
    });
  }, [tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function changeTab(next: string) {
    const value = inventoryTabFrom(next);
    setTab(value);
    router.replace(`${inventoryPath(tenantId)}?tab=${value}`, { scroll: false });
  }

  return (
    <PortalArea>
      <PortalPageHeader
        title={t("ingredientsAndStock")}
        description={t("inventoryDescription")}
        meta={<span className="qosp-meta-line">{t("inventoryMasterDataNote")}</span>}
        actions={isAdministrator ? <TabActions tenantId={tenantId} tab={tab} /> : null}
      />

      <div className="qosp-stack">
        <PortalNotice tone="info">{t("inventoryEmptyBody")}</PortalNotice>
        {branch.status === "ready" && !isAdministrator ? (
          <PortalNotice tone="info">{t("inventoryReadOnlyNote")}</PortalNotice>
        ) : null}

        <PortalFilterTabs
          label={t("inventoryTabsLabel")}
          value={tab}
          onChange={changeTab}
          controls="inventory-list"
          tabs={[
            { id: "items", label: t("inventoryItemsTab"), count: data?.items.length },
            { id: "units", label: t("inventoryUnitsTab"), count: data?.units.length },
            { id: "suppliers", label: t("inventorySuppliersTab"), count: data?.suppliers.length },
            { id: "warehouses", label: t("inventoryWarehousesTab"), count: data?.warehouses.length },
          ]}
        />

        <div id="inventory-list">
          {failed ? (
            <PortalNotice tone="error">{t("inventoryLoadError")}</PortalNotice>
          ) : !data ? (
            <PortalPanel>
              <p className="qosp-meta-line" role="status">
                {t("inventoryLoading")}
              </p>
            </PortalPanel>
          ) : tab === "items" ? (
            <ItemsList tenantId={tenantId} items={data.items} />
          ) : tab === "units" ? (
            <UnitsList tenantId={tenantId} units={data.units} canEdit={isAdministrator} />
          ) : tab === "suppliers" ? (
            <SuppliersList tenantId={tenantId} suppliers={data.suppliers} />
          ) : (
            <WarehousesList tenantId={tenantId} warehouses={data.warehouses} />
          )}
        </div>
      </div>
    </PortalArea>
  );
}

/** Add actions for the open tab only, so the header holds at most two buttons at 360px. */
function TabActions({ tenantId, tab }: { tenantId: string; tab: InventoryTab }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const link = (href: string, label: StaffUiCopyKey, variant: "primary" | "secondary" = "primary") => (
    <Link key={label} className="qos-btn" data-variant={variant} data-size="sm" href={inventoryPath(tenantId, href)}>
      {t(label)}
    </Link>
  );
  return (
    <div className="qosp-button-row">
      {tab === "items"
        ? link("/items/new", "addItem")
        : tab === "units"
          ? [
              link("/units/new?source=standard", "addStandardUnit"),
              link("/units/new?source=custom", "addCustomUnit", "secondary"),
            ]
          : tab === "suppliers"
            ? link("/suppliers/new", "addSupplier")
            : link("/warehouses/new", "addWarehouse")}
    </div>
  );
}

function ItemsList({ tenantId, items }: { tenantId: string; items: ItemSummaryView[] }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("inventoryItemsTab")}</h2>
      <p className="qosp-panel-help">{staffCount(locale, "inventoryItems", items.length)}</p>
      {items.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("inventoryItemsEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("inventoryItemsTab")}>
          {items.map((item) => {
            const name = localName(locale, item.nameEn, item.nameAr);
            return (
              <li key={item.publicId} className="qosp-branch-row qosp-subcard">
                <div className="qosp-branch-row-main">
                  <strong className="qosp-branch-row-name" dir={name.dir}>
                    {name.text}
                  </strong>
                  <span>{t(item.kind === "prepared" ? "itemKindPrepared" : "itemKindPurchased")}</span>
                </div>
                <dl className="qosp-branch-row-main qosp-inventory-units">
                  <UnitCode label={t("storageUnit")} code={item.storageUnitCode} />
                  <UnitCode label={t("recipeUnit")} code={item.recipeUnitCode} />
                  <UnitCode label={t("purchaseUnit")} code={item.purchaseUnitCode} />
                </dl>
                <div className="qosp-branch-row-status">
                  <span className="qosp-branch-row-label">{staffCount(locale, "conversionRules", item.currentRuleCount)}</span>
                  {item.previewStatus === "none" ? null : (
                    <PortalBadge tone={item.previewStatus === "complete" ? "positive" : "warm"} wrap>
                      {t(item.previewStatus === "complete" ? "previewComplete" : "previewIncomplete")}
                    </PortalBadge>
                  )}
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

function UnitCode({ label, code }: { label: string; code: string | null }) {
  const { locale } = useStaffLocale();
  return (
    <div className="qosp-inventory-unit-line">
      <dt className="qosp-branch-row-label">{label}</dt>
      <dd>{code ? <bdi dir="ltr">{code}</bdi> : staffUiCopy(locale, "unitNotSet")}</dd>
    </div>
  );
}

function UnitsList({ tenantId, units, canEdit }: { tenantId: string; units: UnitView[]; canEdit: boolean }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("inventoryUnitsTab")}</h2>
      <p className="qosp-panel-help">{staffCount(locale, "inventoryUnits", units.length)}</p>
      {units.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("inventoryUnitsEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("inventoryUnitsTab")}>
          {units.map((unit) => (
            <li key={unit.publicId} className="qosp-branch-row qosp-subcard">
              <div className="qosp-branch-row-main">
                <code className="qosp-code" dir="ltr">
                  {unit.code}
                </code>
                <strong className="qosp-branch-row-name">{locale === "ar" ? unit.nameAr : unit.nameEn}</strong>
              </div>
              <div className="qosp-branch-row-main">
                <span className="qosp-branch-row-label">{t("quantityKind")}</span>
                <span>{t(QUANTITY_KIND_LABEL[unit.quantityKind])}</span>
                <span className="qosp-branch-row-label">{t("decimalPlaces")}</span>
                <bdi dir="ltr">{unit.decimalPlaces}</bdi>
              </div>
              <div className="qosp-branch-row-status">
                <PortalBadge tone={unit.standardCode ? "positive" : "neutral"}>
                  {t(unit.standardCode ? "standardUnitBadge" : "customUnitBadge")}
                </PortalBadge>
                <PortalBadge tone={unit.status === "active" ? "positive" : "danger"}>
                  {t(unit.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                </PortalBadge>
              </div>
              <div className="qosp-branch-row-status">
                {canEdit ? (
                  <Link
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    href={inventoryPath(tenantId, `/units/${unit.publicId}/edit`)}
                  >
                    {t("editUnit")}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PortalPanel>
  );
}

function SuppliersList({ tenantId, suppliers }: { tenantId: string; suppliers: SupplierView[] }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("inventorySuppliersTab")}</h2>
      <p className="qosp-panel-help">{staffCount(locale, "inventorySuppliers", suppliers.length)}</p>
      {suppliers.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("inventorySuppliersEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("inventorySuppliersTab")}>
          {suppliers.map((supplier) => {
            const name = localName(locale, supplier.nameEn, supplier.nameAr);
            const contact = [supplier.contactName, supplier.phone, supplier.email].filter(Boolean);
            return (
              <li key={supplier.publicId} className="qosp-branch-row qosp-subcard">
                <div className="qosp-branch-row-main">
                  <strong className="qosp-branch-row-name" dir={name.dir}>
                    {name.text}
                  </strong>
                  {supplier.code ? (
                    <code className="qosp-code" dir="ltr">
                      {supplier.code}
                    </code>
                  ) : null}
                </div>
                {contact.length > 0 ? (
                  <div className="qosp-branch-row-main qosp-inventory-contact">
                    {contact.map((value) => (
                      <bdi key={value} dir="ltr">
                        {value}
                      </bdi>
                    ))}
                  </div>
                ) : null}
                <div className="qosp-branch-row-status">
                  <PortalBadge tone={supplier.status === "active" ? "positive" : "danger"}>
                    {t(supplier.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
                </div>
                <div className="qosp-branch-row-status">
                  <Link
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    href={inventoryPath(tenantId, `/suppliers/${supplier.publicId}`)}
                  >
                    {t("openSupplier")}
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

function WarehousesList({ tenantId, warehouses }: { tenantId: string; warehouses: WarehouseView[] }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("inventoryWarehousesTab")}</h2>
      <p className="qosp-panel-help">{staffCount(locale, "inventoryWarehouses", warehouses.length)}</p>
      {warehouses.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("inventoryWarehousesEmpty")}</PortalNotice>
        </div>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("inventoryWarehousesTab")}>
          {warehouses.map((warehouse) => {
            const name = localName(locale, warehouse.nameEn, warehouse.nameAr);
            return (
              <li key={warehouse.publicId} className="qosp-branch-row qosp-subcard">
                <div className="qosp-branch-row-main">
                  <strong className="qosp-branch-row-name" dir={name.dir}>
                    {name.text}
                  </strong>
                  <code className="qosp-code" dir="ltr">
                    {warehouse.code}
                  </code>
                </div>
                <div className="qosp-branch-row-main">
                  <span className="qosp-branch-row-label">{t("warehouseBranch")}</span>
                  <bdi>{warehouse.branch.name}</bdi>
                </div>
                <div className="qosp-branch-row-status">
                  {warehouse.branch.status === "suspended" ? (
                    <PortalBadge tone="warm">{t("branchStatusSuspended")}</PortalBadge>
                  ) : null}
                  <PortalBadge tone={warehouse.status === "active" ? "positive" : "danger"}>
                    {t(warehouse.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
                </div>
                <div className="qosp-branch-row-status">
                  <Link
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    href={inventoryPath(tenantId, `/warehouses/${warehouse.publicId}`)}
                  >
                    {t("openWarehouse")}
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
