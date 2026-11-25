"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConsumptionPreviewPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/consumption-preview-panel";
import { LinkDialog, type LinkDialogState } from "@/app/tenants/[tenantId]/catalogue/recipes/link-dialog";
import { RecipeStateBadges } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-states";
import { decimalText, recipesApiPath, recipesPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { Modal } from "@/components/Modal";
import { PortalBadge, PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { SellableLinksView, VariantLinkRowView } from "@/lib/recipes/links";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 Sellable links tab: every sold variant, grouped by product, with
   its recipe or direct-stock link and the missing states. Shared recipes and
   direct-stock links are labelled as outside the workbook template. The
   stock-product flag on a product never creates a link; a flagged variant
   without one says it needs a direct-stock link. */

export function SellableLinksTab({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [view, setView] = useState<SellableLinksView | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<LinkDialogState | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [ending, setEnding] = useState<{ row: VariantLinkRowView; effectiveTo: string } | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await inventoryApi<SellableLinksView>(recipesApiPath(tenantId, "/sellable-links"));
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setView(result.data);
  }, [tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const products = useMemo(() => {
    const groups = new Map<string, VariantLinkRowView[]>();
    for (const row of view?.variants ?? []) {
      groups.set(row.productPublicId, [...(groups.get(row.productPublicId) ?? []), row]);
    }
    return [...groups.values()];
  }, [view]);

  function open(row: VariantLinkRowView, kind: "recipe" | "direct_stock", replace: boolean) {
    setNotice(null);
    setDialogKey((key) => key + 1);
    setDialog({ variant: row, kind, replace });
  }

  async function endLink() {
    if (!ending?.row.link) return;
    setBusy(true);
    setEndError(null);
    const result = await inventoryApi<SellableLinksView>(recipesApiPath(tenantId, `/sellable-links/${ending.row.link.publicId}`), {
      method: "PATCH",
      body: { operation: "end", effectiveTo: ending.effectiveTo || null },
    });
    setBusy(false);
    if (!result.ok) {
      setEndError(inventoryFailureText(locale, result));
      return;
    }
    setView(result.data);
    setEnding(null);
    setNotice(t("linkEnded"));
  }

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("recipesLinksTab")}</h2>
      <p className="qosp-panel-help">{t("linksHelp")}</p>
      <div className="qosp-panel-body qosp-stack">
        <PortalNotice tone="info">{t("linkNotInWorkbookNotice")}</PortalNotice>
        {notice ? <PortalNotice tone="success">{notice}</PortalNotice> : null}
        {failed ? (
          <PortalNotice tone="error">{t("recipesLoadError")}</PortalNotice>
        ) : !view ? (
          <p className="qosp-meta-line" role="status">
            {t("recipesLoading")}
          </p>
        ) : products.length === 0 ? (
          <PortalNotice tone="info">{t("linksEmpty")}</PortalNotice>
        ) : (
          products.map((rows) => {
            const first = rows[0]!;
            const product = localName(locale, first.productNameEn, first.productNameAr);
            return (
              <section key={first.productPublicId} className="qosp-subcard qosp-stack" aria-label={product.text}>
                <div className="qosp-meta-row qosp-recipe-product-head">
                  <h3 className="qosp-subcard-title" dir={product.dir}>
                    {product.text}
                  </h3>
                  {first.directStockIntent ? <PortalBadge tone="neutral" wrap>{t("linkStockProductFlag")}</PortalBadge> : null}
                  <span className="qosp-meta-line">{staffCount(locale, "productVariants", rows.length)}</span>
                </div>
                <ul className="qosp-branch-list" aria-label={product.text}>
                  {rows.map((row) => (
                    <li key={row.variantPublicId} className="qosp-stack">
                      <VariantRow
                        tenantId={tenantId}
                        row={row}
                        canEdit={canEdit}
                        onLink={(kind) => open(row, kind, false)}
                        onReplace={() => open(row, row.link?.kind ?? "recipe", true)}
                        onEnd={() => {
                          setEndError(null);
                          setEnding({ row, effectiveTo: "" });
                        }}
                        previewOpen={previewing === row.variantPublicId}
                        onPreview={() => setPreviewing(previewing === row.variantPublicId ? null : row.variantPublicId)}
                      />
                      {previewing === row.variantPublicId ? (
                        <ConsumptionPreviewPanel tenantId={tenantId} variantPublicId={row.variantPublicId} today={view.today} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
      {view && dialog ? (
        <LinkDialog
          key={dialogKey}
          tenantId={tenantId}
          state={dialog}
          pickers={view.pickers}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            setView(next);
            setDialog(null);
            setNotice(t("linkSaved"));
          }}
        />
      ) : null}
      <Modal
        open={ending !== null}
        size="sm"
        title={t("linkEnd")}
        description={<p className="qosp-panel-help">{t("linkEndConfirm")}</p>}
        onClose={() => setEnding(null)}
        footer={
          <>
            <button type="button" className="qos-btn" data-variant="secondary" onClick={() => setEnding(null)}>
              {t("cancel")}
            </button>
            <button type="button" className="qos-btn" data-variant="primary" disabled={busy} onClick={() => void endLink()}>
              {t("linkEnd")}
            </button>
          </>
        }
      >
        {ending ? (
          <div className="qosp-stack">
            <PortalField label={t("linkEndDate")} help={t("linkEndDateHelp")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={ending.effectiveTo}
                onChange={(event) => setEnding({ ...ending, effectiveTo: event.target.value })}
              />
            </PortalField>
            {endError ? <PortalNotice tone="error">{endError}</PortalNotice> : null}
          </div>
        ) : null}
      </Modal>
    </PortalPanel>
  );
}

function VariantRow({
  tenantId,
  row,
  canEdit,
  onLink,
  onReplace,
  onEnd,
  previewOpen,
  onPreview,
}: {
  tenantId: string;
  row: VariantLinkRowView;
  canEdit: boolean;
  onLink: (kind: "recipe" | "direct_stock") => void;
  onReplace: () => void;
  onEnd: () => void;
  previewOpen: boolean;
  onPreview: () => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const variantName = locale === "ar" && row.variantNameAr ? row.variantNameAr : row.variantNameEn;
  const link = row.link;
  const linkable = row.variantStatus === "active" && row.productStatus !== "archived";
  return (
    <div className="qosp-branch-row qosp-subcard">
      <div className="qosp-branch-row-main">
        <strong className="qosp-branch-row-name">{variantName ?? t("linkVariantDefault")}</strong>
        {row.isDefault && variantName ? <span className="qosp-meta-line">{t("linkVariantDefault")}</span> : null}
      </div>
      <div className="qosp-branch-row-main">
        {!link ? (
          <span>{t("linkNone")}</span>
        ) : link.recipe ? (
          <>
            <span>
              {t("linkKindRecipe")}:{" "}
              <Link href={recipesPath(tenantId, `/${link.recipe.publicId}`)}>
                <bdi dir={locale === "ar" && link.recipe.nameAr ? "rtl" : "ltr"}>
                  {locale === "ar" && link.recipe.nameAr ? link.recipe.nameAr : link.recipe.nameEn}
                </bdi>
              </Link>
            </span>
            {link.recipe.currentVersionNumber !== null ? (
              <span className="qosp-meta-line">
                {staffCopyWith(locale, "linkRecipeCurrentVersion", { number: isolateText(String(link.recipe.currentVersionNumber)) })}
              </span>
            ) : null}
          </>
        ) : link.directStock ? (
          <>
            <span className="qosp-inventory-cost-amount">
              {staffCopyWith(locale, "linkDirectLine", {
                quantity: isolateText(link.directStock.quantity),
                unit: isolateText(link.directStock.unit.code),
                item: isolateText(localName(locale, link.directStock.item.nameEn, link.directStock.item.nameAr).text),
              })}
            </span>
            {link.directStock.inStorageUnit && link.directStock.item.storageUnitCode ? (
              <span className="qosp-meta-line qosp-inventory-cost-amount">
                {staffCopyWith(locale, "linkDirectStorage", {
                  quantity: decimalText(locale, link.directStock.inStorageUnit),
                  unit: isolateText(link.directStock.item.storageUnitCode),
                })}
              </span>
            ) : null}
          </>
        ) : null}
        {link ? (
          <span className="qosp-meta-line">
            {staffCopyWith(locale, link.scheduled ? "linkStarts" : "linkFrom", { date: isolateText(link.effectiveFrom) })}
            {link.effectiveTo ? ` · ${staffCopyWith(locale, "linkEndsOn", { date: isolateText(link.effectiveTo) })}` : ""}
          </span>
        ) : null}
      </div>
      <div className="qosp-branch-row-status">
        {link?.workbookProfile === "shared" ? <PortalBadge tone="neutral" wrap>{t("linkSharedBadge")}</PortalBadge> : null}
        {link?.workbookProfile === "direct_stock" ? <PortalBadge tone="neutral" wrap>{t("linkDirectBadge")}</PortalBadge> : null}
        <RecipeStateBadges states={row.states} />
      </div>
      <div className="qosp-branch-row-status qosp-recipe-actions">
        {canEdit && linkable && !link ? (
          <>
            <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={() => onLink("recipe")}>
              {t("linkRecipe")}
            </button>
            <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={() => onLink("direct_stock")}>
              {t("linkStockItem")}
            </button>
          </>
        ) : null}
        {canEdit && link && link.effectiveTo === null ? (
          <>
            {linkable ? (
              <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={onReplace}>
                {t("linkReplace")}
              </button>
            ) : null}
            <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={onEnd}>
              {t("linkEnd")}
            </button>
          </>
        ) : null}
        <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" aria-expanded={previewOpen} onClick={onPreview}>
          {t("linkPreview")}
        </button>
      </div>
    </div>
  );
}
