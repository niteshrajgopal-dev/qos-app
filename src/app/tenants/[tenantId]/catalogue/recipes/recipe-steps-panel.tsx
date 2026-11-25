"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";

import { recipesApiPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { RecipeDetailView, VersionView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 ordered preparation steps of the working version. English is
   required; Arabic is optional and shown as "Arabic not provided" until it
   is entered, never filled in automatically. Steps are reordered with Move up
   / Move down and saved as one ordered list. No images are stored. */

type Row = { key: string; stepPublicId: string | null; textEn: string; textAr: string };

export function RecipeStepsPanel({
  tenantId,
  detail,
  version,
  editable,
  onChange,
}: {
  tenantId: string;
  detail: RecipeDetailView;
  version: VersionView;
  editable: boolean;
  onChange: (next: RecipeDetailView) => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [rows, setRows] = useState<Row[]>(() =>
    version.steps.map((step) => ({ key: step.publicId, stepPublicId: step.publicId, textEn: step.textEn, textAr: step.textAr ?? "" })),
  );
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState(0);

  function update(index: number, patch: Partial<Row>) {
    setRows(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setRows(next);
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<RecipeDetailView>(
      recipesApiPath(tenantId, `/${detail.recipe.publicId}/versions/${version.publicId}/steps`),
      {
        method: "PUT",
        body: {
          expectedVersion: version.version,
          steps: rows.map((row) => ({ stepPublicId: row.stepPublicId, textEn: row.textEn, textAr: row.textAr.trim() || null })),
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: inventoryFailureText(locale, result) });
      return;
    }
    onChange(result.data);
  }

  const stepTitle = (index: number) => staffCopyWith(locale, "recipeStepNumber", { number: isolateText(String(index + 1)) });

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("recipeStepsTitle")}</h2>
      <p className="qosp-panel-help">{t("recipeStepsHelp")}</p>
      <div className="qosp-panel-body qosp-stack">
        {(editable ? rows.length : version.steps.length) === 0 ? <PortalNotice tone="info">{t("recipeStepsEmpty")}</PortalNotice> : null}
        {editable ? (
          <ol className="qosp-recipe-rows" aria-label={t("recipeStepsTitle")}>
            {rows.map((row, index) => (
              <li key={row.key} className="qosp-subcard qosp-stack">
                <strong className="qosp-subcard-title">{stepTitle(index)}</strong>
                <div className="qosp-form-grid" data-columns="2">
                  <PortalField label={t("recipeStepEn")}>
                    <textarea className="qos-textarea" dir="ltr" rows={2} maxLength={1000} value={row.textEn} onChange={(event) => update(index, { textEn: event.target.value })} />
                  </PortalField>
                  <PortalField label={t("recipeStepAr")}>
                    <textarea className="qos-textarea" dir="rtl" lang="ar" rows={2} maxLength={1000} value={row.textAr} onChange={(event) => update(index, { textAr: event.target.value })} />
                  </PortalField>
                </div>
                <div className="qosp-button-row qosp-recipe-actions">
                  <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp size={14} aria-hidden="true" />
                    {t("recipeMoveUp")}
                  </button>
                  <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown size={14} aria-hidden="true" />
                    {t("recipeMoveDown")}
                  </button>
                  <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={() => setRows(rows.filter((_, position) => position !== index))}>
                    <Trash2 size={14} aria-hidden="true" />
                    {t("recipeRemove")}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="qosp-recipe-rows" aria-label={t("recipeStepsTitle")}>
            {version.steps.map((step, index) => (
              <li key={step.publicId} className="qosp-subcard qosp-stack">
                <strong className="qosp-subcard-title">{stepTitle(index)}</strong>
                {locale === "ar" ? (
                  step.textAr ? (
                    <p className="qosp-inventory-sentence" dir="rtl">
                      {step.textAr}
                    </p>
                  ) : (
                    <>
                      <p className="qosp-inventory-sentence" dir="ltr">
                        {step.textEn}
                      </p>
                      <span className="qosp-meta-line">{t("recipeArabicNotProvided")}</span>
                    </>
                  )
                ) : (
                  <>
                    <p className="qosp-inventory-sentence" dir="ltr">
                      {step.textEn}
                    </p>
                    {step.textAr ? (
                      <p className="qosp-inventory-sentence" dir="rtl" lang="ar">
                        {step.textAr}
                      </p>
                    ) : (
                      <span className="qosp-meta-line">{t("recipeArabicNotProvided")}</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        {notice ? <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice> : null}
        {editable ? (
          <div className="qosp-button-row">
            <button
              type="button"
              className="qos-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={() => {
                setCounter(counter + 1);
                setRows([...rows, { key: `new-${counter}`, stepPublicId: null, textEn: "", textAr: "" }]);
              }}
            >
              {t("recipeAddStep")}
            </button>
            <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
              {t("recipeSaveSteps")}
            </button>
          </div>
        ) : null}
      </div>
    </PortalPanel>
  );
}
