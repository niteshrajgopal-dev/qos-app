"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  productVariantArchiveConfirmCopy,
  productVariantArchiveConfirmReducer,
  productVariantControlDisabled,
  productVariantPriceDisabled,
  productVariantShowsArchive,
  productVariantShowsRestore,
  productVariantsPanelShowsAddForm,
  type ProductVariantArchiveAction,
  type ProductVariantArchiveConfirm,
} from "@/app/tenants/[tenantId]/catalogue/products/product-variants-panel-state";
import { ConfirmDialog } from "@/components/Modal";
import {
  PortalBadge,
  PortalField,
  PortalNotice,
} from "@/components/portal/workspace/PortalWorkspace";
import {
  ChannelPricesBlock,
  SalesChannelAddForm,
  salesChannelCreateBody,
} from "@/components/staff/catalogue/channel-price-grid";
import type { ChannelPriceRowView } from "@/components/staff/catalogue/channel-price-state";
import { useChannelPriceBundle } from "@/components/staff/catalogue/use-channel-price-bundle";
import {
  VariantSellingBasisFields,
} from "@/app/tenants/[tenantId]/catalogue/products/selling-attributes-fields";
import {
  optionalNumberText,
  parseOptionalPositiveNumber,
} from "@/app/tenants/[tenantId]/catalogue/products/selling-attributes-form";
import {
  ReferenceCostEditor,
  ReferenceMarginLine,
  SellingTaxEditor,
} from "@/app/tenants/[tenantId]/catalogue/products/sellable-tax-cost-fields";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { PriceUnit, SellingQuantityBasis } from "@/lib/catalogue/selling-attributes";
import type { CatalogueProductEditorStatus } from "@/lib/catalogue/product-editor-copy";
import type { DraftProductVariantView } from "@/lib/catalogue/variants";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

type VariantTranslation = {
  displayName: string;
};

type VariantRow = {
  publicId: string;
  isDefault: boolean;
  sortOrder: number;
  status: "active" | "archived";
  sellableLinkKind: DraftProductVariantView["sellableLinkKind"];
  sku: string;
  barcode: string;
  amountMinor: number | null;
  sellingQuantityBasis: SellingQuantityBasis | null;
  priceUnit: PriceUnit | null;
  priceUnitQuantity: number | null;
  /** Local text for the quantity input; blank stays undeclared. */
  priceUnitQuantityInput?: string;
  priceTaxBasis: DraftProductVariantView["priceTaxBasis"];
  taxRateBasisPoints: DraftProductVariantView["taxRateBasisPoints"];
  taxProvenance: DraftProductVariantView["taxProvenance"];
  referenceCost: DraftProductVariantView["referenceCost"];
  referenceMargin: DraftProductVariantView["referenceMargin"];
  translations: {
    en: VariantTranslation;
    ar: VariantTranslation;
  };
};

type VariantsResponse = {
  productPublicId: string;
  productVersion: number;
  canEditPrice: boolean;
  variants: VariantRow[];
};

type ProductChannelPrices = {
  canEditPrice: boolean;
  channels: Array<{ publicId: string; workbookSlot: string | null }>;
  variants: Array<{
    variantPublicId: string;
    centralAmountMinor: number | null;
    rows: ChannelPriceRowView[];
  }>;
};

type ProductVariantsPanelProps = {
  tenantId: string;
  productPublicId: string;
  productStatus: CatalogueProductEditorStatus;
};

type NewVariantForm = {
  enLabel: string;
  arLabel: string;
  priceMajor: string;
  sku: string;
  barcode: string;
  publicId: string;
};

const emptyNewVariant = (): NewVariantForm => ({
  enLabel: "",
  arLabel: "",
  priceMajor: "",
  sku: "",
  barcode: "",
  publicId: "",
});

function majorToMinor(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function minorToMajor(value: number | null) {
  if (value == null) {
    return "";
  }

  return (value / 100).toFixed(2);
}

export function ProductVariantsPanel({
  tenantId,
  productPublicId,
  productStatus,
}: ProductVariantsPanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);
  const productReadOnly = productStatus === "archived";
  const [view, setView] = useState<VariantsResponse | null>(null);
  const [newVariant, setNewVariant] = useState<NewVariantForm>(emptyNewVariant);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<ProductVariantArchiveConfirm>({
    targetPublicId: null,
    request: null,
  });

  const channelPricesBase = `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`;
  const channelPrices = useChannelPriceBundle<ProductChannelPrices>(
    `${channelPricesBase}/channel-prices`,
    view?.productVersion,
    staffUiCopy(locale, "channelPriceLoadError"),
  );
  const channelCanEdit = Boolean(channelPrices.bundle?.canEditPrice) && !productReadOnly;

  function variantChannelRows(variantPublicId: string) {
    const entry = channelPrices.bundle?.variants.find((candidate) => candidate.variantPublicId === variantPublicId);
    return entry && entry.centralAmountMinor != null ? entry.rows : null;
  }

  function saveChannelPrice(variantPublicId: string, row: ChannelPriceRowView, amountMinor: number) {
    return channelPrices.mutate(
      `${channelPricesBase}/variants/${variantPublicId}/channel-prices/${row.channelPublicId}`,
      { method: "PUT", body: JSON.stringify({ amountMinor, expectedVersion: row.version }) },
      copy("channelPriceSaveError"),
      copy("channelPriceSaved"),
    );
  }

  function resetChannelPrice(variantPublicId: string, row: ChannelPriceRowView) {
    return channelPrices.mutate(
      `${channelPricesBase}/variants/${variantPublicId}/channel-prices/${row.channelPublicId}/reset`,
      { method: "POST", body: JSON.stringify({ expectedVersion: row.version }) },
      copy("channelPriceSaveError"),
      copy("channelPriceResetDone"),
    );
  }

  const archiveTarget =
    view?.variants.find((variant) => variant.publicId === archiveConfirm.targetPublicId) ?? null;
  const archiveCopy = archiveTarget
    ? productVariantArchiveConfirmCopy(locale, archiveTarget)
    : null;

  const activeVariants = useMemo(
    () => view?.variants.filter((variant) => variant.status === "active") ?? [],
    [view],
  );

  const loadVariants = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants`,
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? staffUiCopy(locale, "variantsLoadError"));
      }

      setView(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : staffUiCopy(locale, "variantsLoadError"),
      );
    } finally {
      setBusy(false);
    }
  }, [locale, productPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadVariants();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadVariants]);

  async function saveVariant(
    variantPublicId: string,
    patch: Record<string, unknown>,
    successMessage = copy("variantSaved"),
  ) {
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants/${variantPublicId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            ...patch,
          }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.field
            ? `${payload.error ?? copy("variantSaveError")} (${payload.field})`
            : payload.error ?? copy("variantSaveError"),
        );
      }

      setView(payload);
      setMessage(successMessage);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : copy("variantSaveError"),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleArchiveConfirm(action: ProductVariantArchiveAction) {
    const next = productVariantArchiveConfirmReducer(archiveConfirm, action);
    setArchiveConfirm(next);
    if (next.request) {
      void saveVariant(next.request.variantPublicId, next.request.body, copy("variantArchived"));
    }
  }

  async function restoreVariant(variantPublicId: string) {
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants/${variantPublicId}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ expectedProductVersion: view.productVersion }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? copy("variantRestoreError"));
      }

      setView(payload);
      setMessage(copy("variantRestored"));
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : copy("variantRestoreError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateVariant(event: React.FormEvent) {
    event.preventDefault();
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const amountMinor = newVariant.priceMajor.trim()
      ? majorToMinor(newVariant.priceMajor)
      : null;

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            publicId: newVariant.publicId.trim() || undefined,
            translations: {
              en: { displayName: newVariant.enLabel.trim() },
              ar: { displayName: newVariant.arLabel.trim() },
            },
            sku: newVariant.sku.trim() || null,
            barcode: newVariant.barcode.trim() || null,
            amountMinor,
          }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.field
            ? `${payload.error ?? copy("variantCreateError")} (${payload.field})`
            : payload.error ?? copy("variantCreateError"),
        );
      }

      setView(payload);
      setNewVariant(emptyNewVariant());
      setMessage(copy("variantAdded"));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : copy("variantCreateError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleReorder(variantPublicId: string, direction: "up" | "down") {
    if (!view) {
      return;
    }

    const ordered = activeVariants.map((variant) => variant.publicId);
    const index = ordered.indexOf(variantPublicId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) {
      return;
    }

    [ordered[index], ordered[targetIndex]] = [
      ordered[targetIndex],
      ordered[index],
    ];

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants/reorder`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            orderedPublicIds: ordered,
          }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? copy("variantReorderError"));
      }

      setView(payload);
      setMessage(copy("variantOrderUpdated"));
    } catch (reorderError) {
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : copy("variantReorderError"),
      );
    } finally {
      setBusy(false);
    }
  }

  function updateVariant(variantPublicId: string, patch: (entry: VariantRow) => VariantRow) {
    if (!view) {
      return;
    }

    setView({
      ...view,
      variants: view.variants.map((entry) =>
        entry.publicId === variantPublicId ? patch(entry) : entry,
      ),
    });
  }

  return (
    <div className="qosp-stack">
      <div className="qosp-button-row" data-align="end">
        <button
          type="button"
          onClick={() => void loadVariants()}
          disabled={productVariantControlDisabled(productReadOnly, false, busy)}
          className="qos-btn" data-variant="secondary" data-size="sm"
        >
          {copy("reload")}
        </button>
      </div>

      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {message ? <PortalNotice tone="success">{message}</PortalNotice> : null}

      {(view?.variants ?? []).map((variant) => {
        const archived = variant.status === "archived";
        const fieldDisabled = productVariantControlDisabled(productReadOnly, archived, busy);

        return (
          <article key={variant.publicId} className="qosp-subcard" data-muted={archived}>
            <div className="qosp-meta-row">
              <code className="qosp-code">{variant.publicId}</code>
              {variant.isDefault ? (
                <PortalBadge tone="positive">{copy("variantDefault")}</PortalBadge>
              ) : null}
              {archived ? (
                <PortalBadge tone="neutral">{copy("productEditorStatusArchived")}</PortalBadge>
              ) : null}
            </div>

            {archived ? (
              <div className="qosp-meta-row">
                <p className="qosp-meta-line">{copy("variantArchivedHelp")}</p>
                {productVariantShowsRestore(
                  productReadOnly,
                  variant.status,
                  view?.canEditPrice ?? false,
                ) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restoreVariant(variant.publicId)}
                    className="qos-btn" data-variant="secondary" data-size="sm"
                  >
                    {copy("variantRestore")}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="qosp-form-grid" data-columns="2">
              <PortalField label={copy("variantEnglishLabel")}>
                <input
                  className="qos-input"
                  dir="ltr"
                  value={variant.translations.en.displayName}
                  disabled={fieldDisabled}
                  onChange={(event) =>
                    updateVariant(variant.publicId, (entry) => ({
                      ...entry,
                      translations: {
                        ...entry.translations,
                        en: { displayName: event.target.value },
                      },
                    }))
                  }
                />
              </PortalField>
              <PortalField label={copy("variantArabicLabel")}>
                <input
                  className="qos-input"
                  dir="rtl"
                  lang="ar"
                  value={variant.translations.ar.displayName}
                  disabled={fieldDisabled}
                  onChange={(event) =>
                    updateVariant(variant.publicId, (entry) => ({
                      ...entry,
                      translations: {
                        ...entry.translations,
                        ar: { displayName: event.target.value },
                      },
                    }))
                  }
                />
              </PortalField>
              <PortalField label={copy("variantPriceLabel")}>
                <input
                  className="qos-input"
                  inputMode="decimal"
                  dir="ltr"
                  value={minorToMajor(variant.amountMinor)}
                  disabled={productVariantPriceDisabled(
                    productReadOnly,
                    archived,
                    busy,
                    view?.canEditPrice ?? false,
                  )}
                  onChange={(event) =>
                    updateVariant(variant.publicId, (entry) => ({
                      ...entry,
                      amountMinor: majorToMinor(event.target.value),
                    }))
                  }
                />
              </PortalField>
              <PortalField label={copy("productEditorSkuLabel")}>
                <input
                  className="qos-input"
                  dir="ltr"
                  value={variant.sku ?? ""}
                  disabled={fieldDisabled}
                  onChange={(event) =>
                    updateVariant(variant.publicId, (entry) => ({
                      ...entry,
                      sku: event.target.value,
                    }))
                  }
                />
              </PortalField>
            </div>

            <VariantSellingBasisFields
              locale={locale}
              disabled={fieldDisabled}
              value={{
                sellingQuantityBasis: variant.sellingQuantityBasis,
                priceUnit: variant.priceUnit,
                priceUnitQuantityInput:
                  variant.priceUnitQuantityInput ?? optionalNumberText(variant.priceUnitQuantity),
              }}
              onChange={(patch) =>
                updateVariant(variant.publicId, (entry) => ({ ...entry, ...patch }))
              }
            />

            <section className="qosp-stack" aria-label={copy("sellableTaxCostTitle")}>
              <h4 className="qosp-subcard-title">{copy("sellableTaxCostTitle")}</h4>
              <p className="qosp-meta-line">
                {copy("sellableTaxCostHelp")}
                {view?.canEditPrice ? null : ` ${copy("sellableTaxCostAdminNotice")}`}
              </p>
              <SellingTaxEditor
                key={`tax:${variant.priceTaxBasis}:${variant.taxRateBasisPoints}`}
                locale={locale}
                value={variant}
                disabled={productVariantPriceDisabled(
                  productReadOnly,
                  archived,
                  busy,
                  view?.canEditPrice ?? false,
                )}
                onSave={(patch) => void saveVariant(variant.publicId, patch)}
              />
              <h4 className="qosp-subcard-title">{copy("sellableCostPolicyLabel")}</h4>
              <ReferenceCostEditor
                key={`cost:${variant.referenceCost.policy?.publicId ?? "none"}`}
                locale={locale}
                referenceCost={variant.referenceCost}
                disabled={productVariantPriceDisabled(
                  productReadOnly,
                  archived,
                  busy,
                  view?.canEditPrice ?? false,
                )}
                onApply={(costPolicy) => void saveVariant(variant.publicId, { costPolicy })}
              />
              <ReferenceMarginLine locale={locale} margin={variant.referenceMargin} />
            </section>

            {variant.status === "active" && !productReadOnly ? (
              <div className="qosp-button-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const priceUnitQuantity = parseOptionalPositiveNumber(
                      variant.priceUnitQuantityInput ?? optionalNumberText(variant.priceUnitQuantity),
                    );
                    if (priceUnitQuantity === "invalid") {
                      setError(copy("variantPriceUnitQuantityInvalid"));
                      return;
                    }
                    void saveVariant(variant.publicId, {
                      translations: variant.translations,
                      sku: variant.sku?.trim() || null,
                      barcode: variant.barcode?.trim() || null,
                      amountMinor: variant.amountMinor,
                      sellingQuantityBasis: variant.sellingQuantityBasis,
                      priceUnit: variant.priceUnit,
                      priceUnitQuantity,
                    });
                  }}
                  className="qos-btn" data-variant="primary" data-size="sm"
                >
                  {copy("variantSave")}
                </button>
                {!variant.isDefault ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveVariant(variant.publicId, { isDefault: true })}
                    className="qos-btn" data-variant="secondary" data-size="sm"
                  >
                    {copy("variantMakeDefault")}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReorder(variant.publicId, "up")}
                  className="qos-btn" data-variant="secondary" data-size="sm"
                >
                  {copy("variantMoveUp")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReorder(variant.publicId, "down")}
                  className="qos-btn" data-variant="secondary" data-size="sm"
                >
                  {copy("variantMoveDown")}
                </button>
                {productVariantShowsArchive(productReadOnly, variant) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handleArchiveConfirm({ type: "open", variantPublicId: variant.publicId })
                    }
                    className="qos-btn" data-variant="danger" data-size="sm"
                  >
                    {copy("variantArchive")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {variant.status === "active" ? (
              <ChannelPricesBlock
                locale={locale}
                channelCount={channelPrices.bundle?.channels.length ?? 0}
                rows={variantChannelRows(variant.publicId)}
                canEdit={channelCanEdit}
                disabled={productReadOnly || channelPrices.busy}
                onSave={(row, amountMinor) => saveChannelPrice(variant.publicId, row, amountMinor)}
                onReset={(row) => resetChannelPrice(variant.publicId, row)}
              />
            ) : null}
          </article>
        );
      })}

      {/* Portalled: the glass section around this panel is the containing block for fixed overlays. */}
      {archiveTarget ? createPortal(
        <ConfirmDialog
          open
          tone="danger"
          title={archiveCopy?.title}
          confirmLabel={archiveCopy?.confirmLabel}
          cancelLabel={archiveCopy?.cancelLabel}
          onClose={() => handleArchiveConfirm({ type: "cancel" })}
          onConfirm={() =>
            view
              ? handleArchiveConfirm({ type: "confirm", productVersion: view.productVersion })
              : handleArchiveConfirm({ type: "cancel" })
          }
        >
          <div className="qosp-stack">
            <p className="qosp-panel-help">{archiveCopy?.body}</p>
            {archiveCopy?.linkNotice ? (
              <PortalNotice tone="warning">{archiveCopy.linkNotice}</PortalNotice>
            ) : null}
          </div>
        </ConfirmDialog>,
        document.body,
      ) : null}

      {channelPrices.error ? <PortalNotice tone="error">{channelPrices.error}</PortalNotice> : null}
      {channelPrices.message ? <PortalNotice tone="success">{channelPrices.message}</PortalNotice> : null}
      {channelCanEdit ? (
        <SalesChannelAddForm
          locale={locale}
          disabled={channelPrices.busy}
          takenSlots={(channelPrices.bundle?.channels ?? []).flatMap((channel) =>
            channel.workbookSlot ? [channel.workbookSlot] : [],
          )}
          onAdd={(draft) =>
            channelPrices.mutate(
              `/api/tenants/${tenantId}/catalogue/sales-channels`,
              { method: "POST", body: JSON.stringify(salesChannelCreateBody(draft)) },
              copy("salesChannelAddError"),
              copy("salesChannelAdded"),
              true,
            )
          }
        />
      ) : null}

      {productVariantsPanelShowsAddForm(productReadOnly) ? (
        <form
          onSubmit={(event) => void handleCreateVariant(event)}
          className="qosp-subcard qosp-stack"
          data-dashed="true"
        >
          <h3 className="qosp-subcard-title">{copy("variantAddTitle")}</h3>
          <div className="qosp-form-grid" data-columns="2">
            <PortalField label={copy("variantEnglishLabel")}>
              <input
                className="qos-input"
                dir="ltr"
                value={newVariant.enLabel}
                disabled={busy}
                onChange={(event) => setNewVariant({ ...newVariant, enLabel: event.target.value })}
              />
            </PortalField>
            <PortalField label={copy("variantArabicLabel")}>
              <input
                className="qos-input"
                dir="rtl"
                lang="ar"
                value={newVariant.arLabel}
                disabled={busy}
                onChange={(event) => setNewVariant({ ...newVariant, arLabel: event.target.value })}
              />
            </PortalField>
            <PortalField label={copy("variantPriceLabel")}>
              <input
                className="qos-input"
                inputMode="decimal"
                dir="ltr"
                value={newVariant.priceMajor}
                disabled={busy || view?.canEditPrice === false}
                onChange={(event) =>
                  setNewVariant({ ...newVariant, priceMajor: event.target.value })
                }
              />
            </PortalField>
            <PortalField label={copy("variantPublicIdLabel")}>
              <input
                className="qos-input"
                dir="ltr"
                placeholder="var_medium_abc12345"
                value={newVariant.publicId}
                disabled={busy}
                onChange={(event) =>
                  setNewVariant({ ...newVariant, publicId: event.target.value })
                }
              />
            </PortalField>
          </div>
          <div className="qosp-button-row">
            <button type="submit" disabled={busy || !view} className="qos-btn" data-variant="primary">
              {copy("variantAddTitle")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
