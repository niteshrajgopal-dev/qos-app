"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { RecipeEffectsPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-effects-panel";
import { RecipeLinesPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-lines-panel";
import { RecipeLinksPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-links-panel";
import { RecipeStateBadges } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-states";
import { RecipeStepsPanel } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-steps-panel";
import { RecipeVersionsPanel, workingVersion } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-versions-panel";
import { recipesApiPath, recipesPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { DependencyNotice } from "@/app/tenants/[tenantId]/inventory/dependency-notice";
import { inventoryApi, inventoryFailureText, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
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
import type { ItemSummaryView } from "@/lib/inventory/items";
import type { UnitView } from "@/lib/inventory/shared";
import type { RecipeDetailView } from "@/lib/recipes/views";
import { staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 recipe screen. A new recipe is created with its version 1 draft;
   the detail shows the family (names, kind, notes, archive or restore), the
   current and draft versions with yield and approval, the ordered ingredient
   lines and preparation steps of the working version, the variants linked to
   it and the full version history. Approved versions are read-only; only the
   open draft can be edited. Saving produces nothing and moves no stock. */

type Form = { nameEn: string; nameAr: string; kind: "sellable" | "prepared"; outputItemPublicId: string; notes: string; yieldQuantity: string; yieldUnitPublicId: string };

const EMPTY_FORM: Form = { nameEn: "", nameAr: "", kind: "sellable", outputItemPublicId: "", notes: "", yieldQuantity: "", yieldUnitPublicId: "" };

type Notice = { tone: "success" | "error"; text: string; dependencies?: Dependency[] };

export function RecipeEditorScreen({ tenantId, recipePublicId }: { tenantId: string; recipePublicId?: string }) {
  const { locale } = useStaffLocale();
  const { branch } = usePortalShell();
  const router = useRouter();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [detail, setDetail] = useState<RecipeDetailView | null>(null);
  const [preparedItems, setPreparedItems] = useState<ItemSummaryView[]>([]);
  const [units, setUnits] = useState<UnitView[]>([]);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canEdit = branch.role === "administrator";

  const applyDetail = useCallback((next: RecipeDetailView) => {
    setDetail(next);
    setForm({
      ...EMPTY_FORM,
      nameEn: next.recipe.nameEn,
      nameAr: next.recipe.nameAr ?? "",
      kind: next.recipe.kind,
      outputItemPublicId: next.recipe.outputItem?.publicId ?? "",
      notes: next.recipe.notes ?? "",
    });
  }, []);

  const load = useCallback(async () => {
    if (recipePublicId) {
      const result = await inventoryApi<RecipeDetailView>(recipesApiPath(tenantId, `/${recipePublicId}`));
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      applyDetail(result.data);
    } else {
      const [items, unitList] = await Promise.all([
        inventoryApi<{ items: ItemSummaryView[] }>(`/api/tenants/${tenantId}/inventory/items`),
        inventoryApi<{ units: UnitView[] }>(`/api/tenants/${tenantId}/inventory/units`),
      ]);
      if (!items.ok || !unitList.ok) {
        setLoadFailed(true);
        return;
      }
      setPreparedItems(items.data.items.filter((item) => item.kind === "prepared" && item.status === "active"));
      setUnits(unitList.data.units.filter((unit) => unit.status === "active"));
    }
    setLoaded(true);
  }, [applyDetail, recipePublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create() {
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<RecipeDetailView>(recipesApiPath(tenantId), {
      method: "POST",
      body: {
        nameEn: form.nameEn,
        nameAr: form.nameAr.trim() ? form.nameAr : null,
        kind: form.kind,
        outputItemPublicId: form.kind === "prepared" ? form.outputItemPublicId || null : null,
        notes: form.notes.trim() ? form.notes : null,
        yieldQuantity: form.yieldQuantity.trim() || null,
        yieldUnitPublicId: form.yieldUnitPublicId || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    router.push(recipesPath(tenantId, `/${result.data.recipe.publicId}`));
  }

  async function patch(body: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    setConfirmArchive(false);
    const result = await inventoryApi<RecipeDetailView>(recipesApiPath(tenantId, `/${detail.recipe.publicId}`), {
      method: "PATCH",
      body: { expectedVersion: detail.recipe.version, ...body },
    });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result), dependencies: result.dependencies });
      return;
    }
    applyDetail(result.data);
    setNotice({ tone: "success", text: t("recipeSaved") });
  }

  const heading = detail ? localName(locale, detail.recipe.nameEn, detail.recipe.nameAr) : null;
  const readOnly = !canEdit;
  const working = detail ? workingVersion(detail) : null;
  const editable = Boolean(canEdit && detail?.recipe.status === "active" && working?.status === "draft");

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: recipesPath(tenantId), label: t("recipeBack") }}
        title={heading ? <span dir={heading.dir}>{heading.text}</span> : t(recipePublicId ? "recipesLoading" : "recipeNewTitle")}
        description={t("recipeGuidanceOnly")}
      />
      <div className="qosp-stack">
        {branch.status === "ready" && readOnly ? <PortalNotice tone="info">{t("recipesReadOnlyNote")}</PortalNotice> : null}
        {loadFailed ? (
          <PortalNotice tone="error">{t("recipesLoadError")}</PortalNotice>
        ) : !loaded ? (
          <PortalPanel>
            <p className="qosp-meta-line" role="status">
              {t("recipesLoading")}
            </p>
          </PortalPanel>
        ) : (
          <>
            <PortalPanel>
              {detail ? (
                <div className="qosp-meta-row">
                  <PortalBadge tone="neutral">{t(detail.recipe.kind === "prepared" ? "recipeKindPrepared" : "recipeKindSellable")}</PortalBadge>
                  <PortalBadge tone={detail.recipe.status === "active" ? "positive" : "danger"}>
                    {t(detail.recipe.status === "active" ? "inventoryStatusActive" : "inventoryStatusArchived")}
                  </PortalBadge>
                  <RecipeStateBadges states={detail.states} />
                </div>
              ) : null}
              <div className="qosp-form-grid" data-columns="2">
                <PortalField label={t("recipeNameEn")}>
                  <input
                    className="qos-input"
                    dir="ltr"
                    value={form.nameEn}
                    maxLength={120}
                    disabled={readOnly}
                    onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
                  />
                </PortalField>
                <PortalField label={t("recipeNameAr")}>
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
                {detail ? (
                  <PortalField label={t("recipeKind")} help={t("recipeKindHelp")}>
                    <span className="qosp-inventory-sentence">
                      {t(detail.recipe.kind === "prepared" ? "recipeKindPrepared" : "recipeKindSellable")}
                    </span>
                  </PortalField>
                ) : (
                  <PortalField label={t("recipeKind")} help={t("recipeKindHelp")}>
                    <select
                      className="qos-input"
                      value={form.kind}
                      disabled={readOnly}
                      onChange={(event) => setForm({ ...form, kind: event.target.value as Form["kind"] })}
                    >
                      <option value="sellable">{t("recipeKindSellable")}</option>
                      <option value="prepared">{t("recipeKindPrepared")}</option>
                    </select>
                  </PortalField>
                )}
                {detail?.recipe.outputItem ? (
                  <PortalField label={t("recipeOutputItem")}>
                    <bdi className="qosp-inventory-sentence" dir={localName(locale, detail.recipe.outputItem.nameEn, detail.recipe.outputItem.nameAr).dir}>
                      {localName(locale, detail.recipe.outputItem.nameEn, detail.recipe.outputItem.nameAr).text}
                    </bdi>
                  </PortalField>
                ) : !detail && form.kind === "prepared" ? (
                  <PortalField label={t("recipeOutputItem")} help={t("recipeOutputItemHelp")}>
                    {preparedItems.length === 0 ? (
                      <PortalNotice tone="info">{t("recipeNoPreparedItems")}</PortalNotice>
                    ) : (
                      <select
                        className="qos-input"
                        value={form.outputItemPublicId}
                        disabled={readOnly}
                        onChange={(event) => setForm({ ...form, outputItemPublicId: event.target.value })}
                      >
                        <option value="">{t("recipeOutputItemNone")}</option>
                        {preparedItems.map((item) => (
                          <option key={item.publicId} value={item.publicId}>
                            {locale === "ar" && item.nameAr ? item.nameAr : item.nameEn}
                          </option>
                        ))}
                      </select>
                    )}
                  </PortalField>
                ) : null}
                {!detail ? (
                  <>
                    <PortalField label={t("recipeYield")} help={t("recipeYieldHelp")}>
                      <input
                        className="qos-input"
                        dir="ltr"
                        inputMode="decimal"
                        value={form.yieldQuantity}
                        disabled={readOnly}
                        onChange={(event) => setForm({ ...form, yieldQuantity: event.target.value })}
                      />
                    </PortalField>
                    <PortalField label={t("recipeYieldUnit")}>
                      <select
                        className="qos-input"
                        value={form.yieldUnitPublicId}
                        disabled={readOnly}
                        onChange={(event) => setForm({ ...form, yieldUnitPublicId: event.target.value })}
                      >
                        <option value="">{t("recipeChooseUnit")}</option>
                        {units.map((unit) => (
                          <option key={unit.publicId} value={unit.publicId}>
                            {`${unit.code} · ${locale === "ar" ? unit.nameAr : unit.nameEn}`}
                          </option>
                        ))}
                      </select>
                    </PortalField>
                  </>
                ) : null}
                <PortalField label={t("inventoryNotes")}>
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
              {detail?.recipe.status === "archived" ? <PortalNotice tone="warning">{t("recipeArchivedNote")}</PortalNotice> : null}
              {notice ? (
                notice.dependencies?.length ? (
                  <div className="qosp-inventory-notices">
                    <DependencyNotice message={notice.text} dependencies={notice.dependencies} />
                  </div>
                ) : (
                  <div className="qosp-inventory-notices">
                    <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice>
                  </div>
                )
              ) : null}
              {canEdit ? (
                <div className="qosp-button-row qosp-inventory-actions">
                  {detail ? (
                    <>
                      <button
                        type="button"
                        className="qos-btn"
                        data-variant="primary"
                        data-size="sm"
                        disabled={busy}
                        onClick={() =>
                          void patch({ nameEn: form.nameEn, nameAr: form.nameAr.trim() ? form.nameAr : null, notes: form.notes.trim() ? form.notes : null })
                        }
                      >
                        {t("recipeSave")}
                      </button>
                      {detail.recipe.status === "active" ? (
                        <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" disabled={busy} onClick={() => setConfirmArchive(true)}>
                          {t("recipeArchive")}
                        </button>
                      ) : (
                        <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" disabled={busy} onClick={() => void patch({ status: "active" })}>
                          {t("recipeRestore")}
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void create()}>
                      {t("recipeCreate")}
                    </button>
                  )}
                </div>
              ) : null}
            </PortalPanel>
            {detail && working ? (
              <>
                <RecipeVersionsPanel tenantId={tenantId} detail={detail} canEdit={canEdit && detail.recipe.status === "active"} onChange={applyDetail} />
                <RecipeLinesPanel key={`lines-${working.publicId}-${working.version}`} tenantId={tenantId} detail={detail} version={working} editable={editable} onChange={applyDetail} />
                {detail.recipe.kind === "sellable" ? (
                  <RecipeEffectsPanel key={`effects-${working.publicId}-${working.version}`} tenantId={tenantId} detail={detail} version={working} editable={editable} onChange={applyDetail} />
                ) : null}
                <RecipeStepsPanel key={`steps-${working.publicId}-${working.version}`} tenantId={tenantId} detail={detail} version={working} editable={editable} onChange={applyDetail} />
                <RecipeLinksPanel tenantId={tenantId} detail={detail} />
              </>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title={t("recipeArchive")}
        description={t("recipeArchiveConfirm")}
        confirmLabel={t("recipeArchive")}
        cancelLabel={t("cancel")}
        onConfirm={() => void patch({ status: "archived" })}
        onClose={() => setConfirmArchive(false)}
      />
    </PortalArea>
  );
}
