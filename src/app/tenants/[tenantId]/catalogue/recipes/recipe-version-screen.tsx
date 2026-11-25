"use client";

import { useCallback, useEffect, useState } from "react";

import { RecipeLinesPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-lines-panel";
import { RecipeEffectsPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-effects-panel";
import { RecipeStepsPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-steps-panel";
import { VersionSummary } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-versions-panel";
import { recipesApiPath, recipesPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { PortalArea, PortalNotice, PortalPageHeader, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { RecipeDetailView, RecipeView, VersionView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 read-only view of one version from the history: its dates, yield,
   ordered lines and steps, and when its approval snapshot was taken. Nothing
   on this screen can be edited. */
export function RecipeVersionScreen({ tenantId, recipePublicId, versionPublicId }: { tenantId: string; recipePublicId: string; versionPublicId: string }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [data, setData] = useState<{ recipe: RecipeView; version: VersionView; today: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const result = await inventoryApi<{ recipe: RecipeView; version: VersionView; today: string }>(
      recipesApiPath(tenantId, `/${recipePublicId}/versions/${versionPublicId}`),
    );
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setData(result.data);
  }, [recipePublicId, tenantId, versionPublicId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const name = data ? localName(locale, data.recipe.nameEn, data.recipe.nameAr) : null;
  // The panels only read the version and the recipe id in read-only mode.
  const detail = data
    ? ({ recipe: data.recipe, versions: [data.version], linkedVariants: [], states: [], today: data.today, pickers: { items: [], units: [], modifierOptions: [] } } satisfies RecipeDetailView)
    : null;

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: recipesPath(tenantId, `/${recipePublicId}`), label: t("recipeBackToRecipe") }}
        title={
          name && data ? (
            <>
              <bdi dir={name.dir}>{name.text}</bdi> · {staffCopyWith(locale, "recipeVersionLabel", { number: isolateText(String(data.version.versionNumber)) })}
            </>
          ) : (
            t("recipesLoading")
          )
        }
        description={t("recipeHistoryHelp")}
      />
      <div className="qosp-stack">
        {failed ? (
          <PortalNotice tone="error">{t("recipesLoadError")}</PortalNotice>
        ) : !data || !detail ? (
          <PortalPanel>
            <p className="qosp-meta-line" role="status">
              {t("recipesLoading")}
            </p>
          </PortalPanel>
        ) : (
          <>
            <PortalPanel>
              <VersionSummary version={data.version} />
              {data.version.snapshotAt ? (
                <p className="qosp-meta-line qosp-inventory-notices">
                  {staffCopyWith(locale, "recipeSnapshotLine", { date: isolateText(data.version.snapshotAt.slice(0, 10)) })}
                </p>
              ) : null}
              {data.version.notes ? (
                <p className="qosp-inventory-sentence qosp-inventory-notices" dir="auto">
                  {data.version.notes}
                </p>
              ) : null}
            </PortalPanel>
            <RecipeLinesPanel tenantId={tenantId} detail={detail} version={data.version} editable={false} onChange={() => undefined} />
            <RecipeEffectsPanel tenantId={tenantId} detail={detail} version={data.version} editable={false} onChange={() => undefined} />
            <RecipeStepsPanel tenantId={tenantId} detail={detail} version={data.version} editable={false} onChange={() => undefined} />
          </>
        )}
      </div>
    </PortalArea>
  );
}
