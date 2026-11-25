"use client";

import Link from "next/link";

import { variantLabel } from "@/app/tenants/[tenantId]/catalogue/recipes/link-dialog";
import { recipesPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { PortalBadge, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { RecipeDetailView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 variants linked to this family. Many variants can point at one
   family (a shared assignment) without copying it; shared links are outside
   the workbook template. A prepared recipe is never linked to a sold variant:
   it describes how its prepared item is made, for guidance and costing. */
export function RecipeLinksPanel({ tenantId, detail }: { tenantId: string; detail: RecipeDetailView }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const shared = detail.linkedVariants.length > 1;
  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("linkedVariantsTitle")}</h2>
      {detail.recipe.kind === "prepared" ? (
        <p className="qosp-panel-help">{t("recipePreparedNotLinked")}</p>
      ) : (
        <>
          <p className="qosp-panel-help">{staffCount(locale, "linkedVariants", detail.linkedVariants.length)}</p>
          <div className="qosp-panel-body qosp-stack">
            {detail.linkedVariants.length === 0 ? (
              <PortalNotice tone="info">{t("linkedVariantsEmpty")}</PortalNotice>
            ) : (
              <ul className="qosp-branch-list" aria-label={t("linkedVariantsTitle")}>
                {detail.linkedVariants.map((variant) => (
                  <li key={variant.linkPublicId} className="qosp-branch-row qosp-subcard" data-columns="3">
                    <div className="qosp-branch-row-main">
                      <strong className="qosp-branch-row-name">{variantLabel(locale, variant)}</strong>
                      <span className="qosp-meta-line">{staffCopyWith(locale, "linkFrom", { date: isolateText(variant.effectiveFrom) })}</span>
                    </div>
                    <div className="qosp-branch-row-status">
                      {shared ? <PortalBadge tone="neutral" wrap>{t("linkSharedBadge")}</PortalBadge> : null}
                      {variant.variantStatus === "archived" || variant.productStatus === "archived" ? (
                        <PortalBadge tone="danger">{t("recipeStateVariantArchived")}</PortalBadge>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="qosp-button-row">
              <Link className="qos-btn" data-variant="secondary" data-size="sm" href={recipesPath(tenantId, "?tab=links")}>
                {t("linkedVariantsManage")}
              </Link>
            </div>
          </div>
        </>
      )}
    </PortalPanel>
  );
}
