"use client";

import { useCallback, useEffect, useState } from "react";

import { decimalText, recipesApiPath, UNRESOLVED_REASON_LABEL } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { PortalBadge, PortalField, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { ConsumptionPreviewView } from "@/lib/recipes/resolution-service";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 consumption preview: what one sale (or several) of a variant uses
   on a business date, resolved by the server to exactly one approved recipe
   version or the direct-stock link. Read-only: nothing is posted. Lines that
   cannot be converted show their state and no quantity. */

export function ConsumptionPreviewPanel({ tenantId, variantPublicId, today }: { tenantId: string; variantPublicId: string; today: string }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("1");
  const [result, setResult] = useState<ConsumptionPreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (forDate: string, forQuantity: string) => {
      setError(null);
      const query = new URLSearchParams({ variantPublicId, date: forDate, quantity: forQuantity });
      const response = await inventoryApi<ConsumptionPreviewView>(recipesApiPath(tenantId, `/consumption-preview?${query.toString()}`));
      if (!response.ok) {
        setResult(null);
        setError(inventoryFailureText(locale, response, "recipesLoadError"));
        return;
      }
      setResult(response.data);
    },
    [locale, tenantId, variantPublicId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void run(today, "1"), 0);
    return () => window.clearTimeout(timer);
  }, [run, today]);

  const recipeName = result?.recipe ? localName(locale, result.recipe.nameEn, result.recipe.nameAr) : null;

  return (
    <div className="qosp-subcard qosp-recipe-preview" data-muted="true">
      <h3 className="qosp-subcard-title">
        {staffCopyWith(locale, "recipePreviewTitle", {
          // Non-breaking hyphens keep the date on one line in a narrow RTL heading.
          date: isolateText((result?.businessDate ?? date).replace(/-/g, "\u2011")),
        })}
      </h3>
      <div className="qosp-form-grid qosp-recipe-preview-form" data-columns="2">
        <PortalField label={t("recipePreviewDate")}>
          <input className="qos-input" dir="ltr" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </PortalField>
        <PortalField label={t("recipePreviewQuantity")}>
          <input className="qos-input" dir="ltr" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </PortalField>
      </div>
      <div className="qosp-button-row qosp-inventory-actions">
        <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={() => void run(date, quantity)}>
          {t("recipePreviewRun")}
        </button>
      </div>
      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {result ? (
        <div className="qosp-stack qosp-inventory-notices">
          {result.status === "unresolved" ? (
            <PortalNotice tone="warning">
              {result.reason === "overlapping_versions"
                ? staffCopyWith(locale, "recipeUnresolvedOverlappingVersions", {
                    versions: isolateText(result.overlappingVersionNumbers.join(", ")),
                  })
                : t(UNRESOLVED_REASON_LABEL[result.reason!])}
            </PortalNotice>
          ) : result.kind === "recipe" && result.version && recipeName ? (
            <p className="qosp-inventory-sentence">
              {staffCopyWith(locale, "recipePreviewVersion", {
                number: isolateText(String(result.version.versionNumber)),
                recipe: isolateText(recipeName.text),
                quantity: isolateText(result.version.yieldQuantity),
                unit: isolateText(result.version.yieldUnitCode),
              })}
            </p>
          ) : (
            <p className="qosp-inventory-sentence">{t("recipePreviewDirect")}</p>
          )}
          {result.lines.length > 0 ? (
            <ul className="qosp-branch-list" aria-label={t("recipeLinesTitle")}>
              {result.lines.map((line) => {
                const item = localName(locale, line.item.nameEn, line.item.nameAr);
                return (
                  <li key={line.linePublicId ?? line.item.publicId} className="qosp-branch-row qosp-subcard" data-columns="3">
                    <div className="qosp-branch-row-main">
                      <strong className="qosp-branch-row-name" dir={item.dir}>
                        {item.text}
                      </strong>
                      {line.prepared ? <PortalBadge tone="neutral" wrap>{t("recipePreviewPrepared")}</PortalBadge> : null}
                    </div>
                    <div className="qosp-branch-row-main">
                      {line.perSale && line.total && line.storageUnitCode ? (
                        <>
                          <span className="qosp-inventory-cost-amount">
                            {staffCopyWith(locale, "recipePreviewPerSale", {
                              quantity: decimalText(locale, line.perSale),
                              unit: isolateText(line.storageUnitCode),
                            })}
                          </span>
                          <span className="qosp-inventory-cost-amount qosp-meta-line">
                            {staffCopyWith(locale, "recipePreviewTotal", {
                              quantity: decimalText(locale, line.total),
                              unit: isolateText(line.storageUnitCode),
                            })}
                          </span>
                        </>
                      ) : (
                        <PortalBadge tone="warm" wrap>
                          {t(line.status === "item_archived" ? "recipeStateItemArchived" : line.status === "storage_unit_missing" ? "recipeStorageUnitMissing" : "recipeStateMissingConversion")}
                        </PortalBadge>
                      )}
                    </div>
                    <div className="qosp-branch-row-status">
                      <span className="qosp-meta-line">
                        {staffCopyWith(locale, "recipePreviewSource", { quantity: isolateText(line.quantity), unit: isolateText(line.unitCode) })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {result.status === "resolved" && !result.complete ? <PortalNotice tone="warning">{t("recipePreviewIncomplete")}</PortalNotice> : null}
          <p className="qosp-meta-line">{t("recipePreviewNothingPosted")}</p>
        </div>
      ) : null}
    </div>
  );
}
