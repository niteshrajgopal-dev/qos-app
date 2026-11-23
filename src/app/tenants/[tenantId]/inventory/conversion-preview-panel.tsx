"use client";

import { Fragment } from "react";

import { PortalBadge, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import {
  type ItemQuantityPreview,
  type PreviewPairKey,
  previewMissingText,
  previewSentences,
} from "@/lib/inventory/conversion-preview";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-195 preview: how this item's purchase, storage and recipe quantities
   convert, computed by the pure explainItemQuantities on the server. Numbers
   and unit codes are isolated so Arabic sentences keep them left to right. */

const PAIR_TITLE: Record<PreviewPairKey, StaffUiCopyKey> = {
  storage_recipe: "previewStorageRecipe",
  purchase_storage: "previewPurchaseStorage",
  purchase_recipe: "previewPurchaseRecipe",
};

export function ConversionPreviewPanel({ preview }: { preview: ItemQuantityPreview }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("conversionPreviewTitle")}</h2>
      <ul className="qosp-branch-list qosp-panel-body" aria-label={t("conversionPreviewTitle")}>
        {preview.pairs.map((pair) => {
          const sentences = previewSentences(locale, pair, isolateText);
          return (
            <li key={pair.key} className="qosp-subcard qosp-inventory-preview">
              <h3 className="qosp-subcard-title">{t(PAIR_TITLE[pair.key])}</h3>
              {pair.result.status === "missing" ? (
                <PortalBadge tone="warm" wrap>
                  {previewMissingText(locale, pair.result.reason)}
                </PortalBadge>
              ) : sentences ? (
                <>
                  <p className="qosp-inventory-sentence">{sentences.forward}</p>
                  <p className="qosp-inventory-sentence">{sentences.inverse}</p>
                  {sentences.example ? <p className="qosp-inventory-sentence">{sentences.example}</p> : null}
                  {sentences.rounding.map((line) => (
                    <p key={line} className="qosp-meta-line">
                      {line}
                    </p>
                  ))}
                  {pair.result.path.length > 0 ? (
                    <div className="qosp-meta-row qosp-inventory-path">
                      <span className="qosp-meta-line">
                        {staffCopyWith(locale, "previewPathLabel", {
                          path: isolateText(
                            [pair.result.path[0]!.fromCode, ...pair.result.path.map((hop) => hop.toCode)].join(" → "),
                          ),
                        })}
                      </span>
                      {pair.result.path.map((hop, index) => (
                        <Fragment key={`${hop.fromCode}-${hop.toCode}-${index}`}>
                          <PortalBadge tone={hop.source === "standard" ? "positive" : "neutral"}>
                            <bdi dir="ltr">{`${hop.fromCode} → ${hop.toCode}`}</bdi>
                            {" · "}
                            {t(hop.source === "standard" ? "previewViaStandard" : "previewViaRule")}
                          </PortalBadge>
                        </Fragment>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </PortalPanel>
  );
}
