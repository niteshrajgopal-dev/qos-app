"use client";

import { useState } from "react";

import { linkReplaceWarningKey, recipesApiPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { Modal } from "@/components/Modal";
import { PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { SellableLinksView, VariantLinkRowView } from "@/lib/recipes/links";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 link dialog: links one sold variant to a sellable recipe family or
   to a stock item, quantity and unit. Replacing ends the current link on the
   new link's start date in the same request; history is never rewritten. */

export type LinkDialogState = { variant: VariantLinkRowView; kind: "recipe" | "direct_stock"; replace: boolean };

export function variantLabel(locale: "en" | "ar", row: Pick<VariantLinkRowView, "productNameEn" | "productNameAr" | "variantNameEn" | "variantNameAr" | "isDefault">) {
  const product = locale === "ar" && row.productNameAr ? row.productNameAr : row.productNameEn;
  const variant = locale === "ar" && row.variantNameAr ? row.variantNameAr : row.variantNameEn;
  return variant ? `${product} · ${variant}` : product;
}

export function LinkDialog({
  tenantId,
  state,
  pickers,
  onClose,
  onSaved,
}: {
  tenantId: string;
  state: LinkDialogState | null;
  pickers: SellableLinksView["pickers"];
  onClose: () => void;
  onSaved: (view: SellableLinksView) => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [kind, setKind] = useState<"recipe" | "direct_stock">(state?.kind ?? "recipe");
  const [recipePublicId, setRecipePublicId] = useState("");
  const [itemPublicId, setItemPublicId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPublicId, setUnitPublicId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state) {
    return null;
  }
  const item = pickers.items.find((entry) => entry.publicId === itemPublicId);
  const units = item ? pickers.units.filter((unit) => item.unitPublicIds.includes(unit.publicId)) : [];
  const name = (entry: { nameEn: string; nameAr: string | null }) => (locale === "ar" && entry.nameAr ? entry.nameAr : entry.nameEn);
  const replaceWarning = linkReplaceWarningKey(state, kind);

  async function submit() {
    if (!state) return;
    setBusy(true);
    setError(null);
    const body =
      kind === "recipe"
        ? { variantPublicId: state.variant.variantPublicId, kind, recipePublicId, effectiveFrom: effectiveFrom || null, replace: state.replace }
        : {
            variantPublicId: state.variant.variantPublicId,
            kind,
            itemPublicId,
            quantity,
            unitPublicId,
            effectiveFrom: effectiveFrom || null,
            replace: state.replace,
          };
    const result = await inventoryApi<SellableLinksView>(recipesApiPath(tenantId, "/sellable-links"), { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      setError(inventoryFailureText(locale, result));
      return;
    }
    onSaved(result.data);
  }

  return (
    <Modal
      open
      size="sm"
      title={staffCopyWith(locale, kind === "recipe" ? "linkDialogRecipeTitle" : "linkDialogStockTitle", {
        variant: variantLabel(locale, state.variant),
      })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="qos-btn" data-variant="secondary" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="button" className="qos-btn" data-variant="primary" disabled={busy} onClick={() => void submit()}>
            {t(state.replace ? "linkReplace" : "linkSave")}
          </button>
        </>
      }
    >
      <div className="qosp-stack">
        {state.replace ? (
          <PortalField label={t("linkKind")}>
            <select className="qos-input" value={kind} onChange={(event) => setKind(event.target.value as "recipe" | "direct_stock")}>
              <option value="recipe">{t("linkKindRecipe")}</option>
              <option value="direct_stock">{t("linkKindDirectStock")}</option>
            </select>
          </PortalField>
        ) : null}
        {replaceWarning ? <PortalNotice tone="warning">{t(replaceWarning)}</PortalNotice> : null}
        {kind === "recipe" ? (
          pickers.recipes.length === 0 ? (
            <PortalNotice tone="info">{t("linkNoRecipes")}</PortalNotice>
          ) : (
            <PortalField label={t("linkChooseRecipe")}>
              <select className="qos-input" value={recipePublicId} onChange={(event) => setRecipePublicId(event.target.value)}>
                <option value="">{t("linkChooseRecipe")}</option>
                {pickers.recipes.map((recipe) => (
                  <option key={recipe.publicId} value={recipe.publicId}>
                    {name(recipe)}
                  </option>
                ))}
              </select>
            </PortalField>
          )
        ) : (
          <>
            <p className="qosp-panel-help">{t("linkStockHelp")}</p>
            <PortalField label={t("recipeLineItem")}>
              <select
                className="qos-input"
                value={itemPublicId}
                onChange={(event) => {
                  setItemPublicId(event.target.value);
                  setUnitPublicId("");
                }}
              >
                <option value="">{t("recipeChooseItem")}</option>
                {pickers.items.map((entry) => (
                  <option key={entry.publicId} value={entry.publicId}>
                    {name(entry)}
                  </option>
                ))}
              </select>
            </PortalField>
            <div className="qosp-form-grid" data-columns="2">
              <PortalField label={t("linkStockQuantity")}>
                <input
                  className="qos-input"
                  dir="ltr"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </PortalField>
              <PortalField label={t("recipeLineUnit")}>
                <select className="qos-input" value={unitPublicId} disabled={!item} onChange={(event) => setUnitPublicId(event.target.value)}>
                  <option value="">{t("recipeChooseUnit")}</option>
                  {units.map((unit) => (
                    <option key={unit.publicId} value={unit.publicId}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </PortalField>
            </div>
          </>
        )}
        <PortalField label={t("linkStartDate")} help={t(state.replace ? "linkReplaceDateHelp" : "linkStartDateHelp")}>
          <input className="qos-input" dir="ltr" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
        </PortalField>
        {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      </div>
    </Modal>
  );
}
