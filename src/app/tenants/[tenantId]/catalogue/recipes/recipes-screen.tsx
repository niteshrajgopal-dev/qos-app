"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RecipeStateBadges } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-states";
import {
  costSummaryText,
  recipesApiPath,
  recipesPath,
} from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { type RecipesTab, recipesTabFrom } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-tabs";
import { SellableLinksTab } from "@/app/tenants/[tenantId]/catalogue/recipes/sellable-links-tab";
import { inventoryApi, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { usePortalShell } from "@/components/portal/portal-shell-context";
import {
  PortalArea,
  PortalBadge,
  PortalField,
  PortalFilterTabs,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
  PortalSearchField,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { RecipeSummaryView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* Catalogue > Recipes (QOS-198): versioned recipe families and the links
   from sold variants to a recipe or a stock item. Everything shown comes from
   the recipes API. Administrators get the add and link actions; other members
   a read-only notice. Nothing here produces, posts or deducts stock. */

type KindFilter = "all" | RecipeSummaryView["kind"];
type StatusFilter = "active" | "archived" | "all";

const normalise = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

export function RecipesScreen({ tenantId, initialTab }: { tenantId: string; initialTab: RecipesTab }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [tab, setTab] = useState<RecipesTab>(initialTab);
  const [recipes, setRecipes] = useState<RecipeSummaryView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const isAdministrator = branch.role === "administrator";

  const load = useCallback(async () => {
    const result = await inventoryApi<{ recipes: RecipeSummaryView[] }>(recipesApiPath(tenantId));
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setRecipes(result.data.recipes);
  }, [tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function changeTab(next: string) {
    const value = recipesTabFrom(next);
    setTab(value);
    router.replace(`${recipesPath(tenantId)}?tab=${value}`, { scroll: false });
  }

  return (
    <PortalArea>
      <PortalPageHeader
        title={t("recipes")}
        description={t("recipesDescription")}
        meta={<span className="qosp-meta-line">{t("recipeGuidanceOnly")}</span>}
        actions={
          isAdministrator && tab === "recipes" ? (
            <Link className="qos-btn" data-variant="primary" data-size="sm" href={recipesPath(tenantId, "/new")}>
              {t("recipeAdd")}
            </Link>
          ) : null
        }
      />
      <div className="qosp-stack">
        {branch.status === "ready" && !isAdministrator ? <PortalNotice tone="info">{t("recipesReadOnlyNote")}</PortalNotice> : null}
        <PortalFilterTabs
          label={t("recipesTabsLabel")}
          value={tab}
          onChange={changeTab}
          controls="recipes-panel"
          tabs={[
            { id: "recipes", label: t("recipesListTab"), count: recipes?.length },
            { id: "links", label: t("recipesLinksTab") },
          ]}
        />
        <div id="recipes-panel">
          {tab === "links" ? (
            <SellableLinksTab tenantId={tenantId} canEdit={isAdministrator} />
          ) : failed ? (
            <PortalNotice tone="error">{t("recipesLoadError")}</PortalNotice>
          ) : !recipes ? (
            <PortalPanel>
              <p className="qosp-meta-line" role="status">
                {t("recipesLoading")}
              </p>
            </PortalPanel>
          ) : (
            <RecipesList tenantId={tenantId} recipes={recipes} />
          )}
        </div>
      </div>
    </PortalArea>
  );
}

function RecipesList({ tenantId, recipes }: { tenantId: string; recipes: RecipeSummaryView[] }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const shown = useMemo(() => {
    const needle = normalise(query.trim());
    return recipes.filter(
      (recipe) =>
        (!needle || normalise(recipe.nameEn).includes(needle) || normalise(recipe.nameAr ?? "").includes(needle)) &&
        (kind === "all" || recipe.kind === kind) &&
        (status === "all" || recipe.status === status),
    );
  }, [recipes, query, kind, status]);

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("recipesListTab")}</h2>
      <p className="qosp-panel-help">{staffCount(locale, "recipesCount", recipes.length)}</p>
      {recipes.length === 0 ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("recipesEmpty")}</PortalNotice>
        </div>
      ) : (
        <>
          <div className="qosp-panel-body qosp-inventory-filters">
            <div className="qosp-field">
              <span className="qosp-field-label" aria-hidden="true">
                {t("recipesFilterSearch")}
              </span>
              <PortalSearchField
                label={t("recipesFilterSearch")}
                placeholder={t("recipesFilterSearchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <PortalField label={t("recipeKind")}>
              <select className="qos-input" value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
                <option value="all">{t("inventoryFilterAll")}</option>
                <option value="sellable">{t("recipeKindSellable")}</option>
                <option value="prepared">{t("recipeKindPrepared")}</option>
              </select>
            </PortalField>
            <PortalField label={t("inventoryFilterStatus")}>
              <select className="qos-input" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                <option value="active">{t("inventoryStatusActive")}</option>
                <option value="archived">{t("inventoryStatusArchived")}</option>
                <option value="all">{t("inventoryFilterAll")}</option>
              </select>
            </PortalField>
          </div>
          <p className="qosp-meta-line qosp-panel-body" role="status">
            {staffCopyWith(locale, "recipesShown", {
              shown: isolateText(String(shown.length)),
              total: isolateText(String(recipes.length)),
            })}
          </p>
          {shown.length === 0 ? (
            <div className="qosp-panel-body">
              <PortalNotice tone="info">{t("recipesFilterNoMatch")}</PortalNotice>
            </div>
          ) : (
            <ul className="qosp-branch-list qosp-panel-body" aria-label={t("recipesListTab")}>
              {shown.map((recipe) => (
                <RecipeRow key={recipe.publicId} tenantId={tenantId} recipe={recipe} />
              ))}
            </ul>
          )}
        </>
      )}
    </PortalPanel>
  );
}

function RecipeRow({ tenantId, recipe }: { tenantId: string; recipe: RecipeSummaryView }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const name = localName(locale, recipe.nameEn, recipe.nameAr);
  const output = recipe.outputItem ? localName(locale, recipe.outputItem.nameEn, recipe.outputItem.nameAr) : null;
  return (
    <li className="qosp-branch-row qosp-subcard">
      <div className="qosp-branch-row-main">
        <strong className="qosp-branch-row-name" dir={name.dir}>
          {name.text}
        </strong>
        <span>{t(recipe.kind === "prepared" ? "recipeKindPrepared" : "recipeKindSellable")}</span>
        {output ? (
          <span className="qosp-meta-line">
            {t("recipeOutputItem")}: <bdi dir={output.dir}>{output.text}</bdi>
          </span>
        ) : null}
      </div>
      <div className="qosp-branch-row-main">
        {recipe.current ? (
          <>
            <span>{staffCopyWith(locale, "recipeVersionLabel", { number: isolateText(String(recipe.current.versionNumber)) })}</span>
            <span className="qosp-meta-line">
              {staffCopyWith(locale, "recipeEffectiveFrom", { date: isolateText(recipe.current.effectiveFrom) })}
            </span>
            <span className="qosp-meta-line">
              {staffCopyWith(locale, "recipeYieldLine", {
                quantity: isolateText(recipe.current.yieldQuantity),
                unit: isolateText(recipe.current.yieldUnitCode),
              })}
            </span>
          </>
        ) : (
          <span className="qosp-meta-line">{t("recipeStateNoApprovedVersion")}</span>
        )}
        {recipe.draft ? (
          <span className="qosp-meta-line">
            {staffCopyWith(locale, "recipeDraftOpen", { number: isolateText(String(recipe.draft.versionNumber)) })}
          </span>
        ) : null}
      </div>
      <div className="qosp-branch-row-status">
        {recipe.kind === "sellable" ? (
          <span className="qosp-branch-row-label">{staffCount(locale, "linkedVariants", recipe.linkedVariantCount)}</span>
        ) : null}
        {recipe.shared ? <PortalBadge tone="neutral" wrap>{t("linkSharedBadge")}</PortalBadge> : null}
        <span className="qosp-inventory-cost-amount">
          {recipe.cost.status === "known"
            ? costSummaryText(locale, recipe.cost, recipe.current?.yieldUnitCode ?? null)
            : recipe.cost.status === "unavailable"
              ? staffCopyWith(locale, "recipeCostUnavailableLine", {
                  count: staffCount(locale, "recipeLinesWithoutCost", recipe.cost.linesWithoutCost),
                })
              : t("recipeCostNoLines")}
        </span>
        <RecipeStateBadges states={recipe.states} />
        {recipe.status === "archived" ? <PortalBadge tone="neutral">{t("inventoryStatusArchived")}</PortalBadge> : null}
      </div>
      <div className="qosp-branch-row-status">
        <Link className="qos-btn" data-variant="secondary" data-size="sm" href={recipesPath(tenantId, `/${recipe.publicId}`)}>
          {t("recipeOpen")}
        </Link>
      </div>
    </li>
  );
}
