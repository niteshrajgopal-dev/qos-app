"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { RecipeStateBadges } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-states";
import { recipesApiPath } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { PortalBadge, PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { EffectView, OptionRef, RecipeDetailView, VersionView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-199 modifier effects of the working version: what a selected option
   adds to, removes from or replaces in this version. On a draft,
   administrators pick an option offered by a product linked to this recipe,
   the effect, the base line it removes or replaces, and the item, quantity
   (per selection, per sale) and unit it adds. The whole list is saved at
   once. Approved versions are read-only; effects change only with a new
   draft. Nothing is posted or deducted. */

type EffectType = EffectView["effectType"];

type Row = {
  key: string;
  effectPublicId: string | null;
  optionPublicId: string;
  effectType: EffectType;
  targetLinePublicId: string;
  itemPublicId: string;
  unitPublicId: string;
  quantity: string;
  notes: string;
};

const TYPE_LABEL: Record<EffectType, StaffUiCopyKey> = {
  add: "recipeEffectTypeAdd",
  remove: "recipeEffectTypeRemove",
  replace: "recipeEffectTypeReplace",
};

function rowsFrom(version: VersionView): Row[] {
  return version.effects.map((effect) => ({
    key: effect.publicId,
    effectPublicId: effect.publicId,
    optionPublicId: effect.option.publicId,
    effectType: effect.effectType,
    targetLinePublicId: effect.targetLine?.publicId ?? "",
    itemPublicId: effect.item?.publicId ?? "",
    unitPublicId: effect.unit?.publicId ?? "",
    quantity: effect.quantity ?? "",
    notes: effect.notes ?? "",
  }));
}

function name(locale: StaffLocale, entry: { nameEn: string; nameAr: string | null }) {
  return localName(locale, entry.nameEn, entry.nameAr);
}

/** "Oat milk" with its group, as one isolated run. */
function optionText(locale: StaffLocale, option: OptionRef) {
  return `${name(locale, option.group).text} · ${name(locale, option).text}`;
}

/** The plain sentence for a saved effect. */
export function effectSentence(locale: StaffLocale, effect: EffectView) {
  const option = isolateText(name(locale, effect.option).text);
  if (effect.effectType === "remove") {
    return staffCopyWith(locale, "recipeEffectSentenceRemove", {
      option,
      item: isolateText(effect.targetLine ? name(locale, effect.targetLine.item).text : ""),
    });
  }
  const values = {
    option,
    quantity: isolateText(effect.quantity ?? ""),
    unit: isolateText(effect.unit?.code ?? ""),
    item: isolateText(effect.item ? name(locale, effect.item).text : ""),
  };
  if (effect.effectType === "add") {
    return staffCopyWith(locale, "recipeEffectSentenceAdd", values);
  }
  return staffCopyWith(locale, "recipeEffectSentenceReplace", {
    ...values,
    target: isolateText(effect.targetLine ? name(locale, effect.targetLine.item).text : ""),
  });
}

export function RecipeEffectsPanel({
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
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(version));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState(0);
  const options = detail.pickers.modifierOptions;

  function update(index: number, patch: Partial<Row>) {
    setRows(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const result = await inventoryApi<RecipeDetailView>(
      recipesApiPath(tenantId, `/${detail.recipe.publicId}/versions/${version.publicId}/effects`),
      {
        method: "PUT",
        body: {
          expectedVersion: version.version,
          effects: rows.map((row) => ({
            effectPublicId: row.effectPublicId,
            optionPublicId: row.optionPublicId,
            effectType: row.effectType,
            targetLinePublicId: row.effectType === "add" ? null : row.targetLinePublicId || null,
            itemPublicId: row.effectType === "remove" ? null : row.itemPublicId || null,
            unitPublicId: row.effectType === "remove" ? null : row.unitPublicId || null,
            quantity: row.effectType === "remove" ? null : row.quantity.trim() || null,
            notes: row.notes.trim() || null,
          })),
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

  const shown = editable ? rows.length : version.effects.length;

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">
        {t("recipeEffectsTitle")} · {staffCopyWith(locale, "recipeVersionLabel", { number: isolateText(String(version.versionNumber)) })}
      </h2>
      <p className="qosp-panel-help">{t("recipeEffectsHelp")}</p>
      <div className="qosp-panel-body qosp-stack">
        <div className="qosp-meta-row">
          <PortalBadge tone="neutral">{staffCount(locale, "recipeEffects", version.effects.length)}</PortalBadge>
        </div>
        {!editable && version.status !== "draft" ? <PortalNotice tone="info">{t("recipeEffectsApprovedReadOnly")}</PortalNotice> : null}
        {version.status === "draft" && version.versionNumber > 1 && version.effects.length > 0 ? (
          <PortalNotice tone="info">{t("recipeEffectsDraftReviewNote")}</PortalNotice>
        ) : null}
        {shown === 0 ? <PortalNotice tone="info">{t("recipeEffectsEmpty")}</PortalNotice> : null}
        {editable && options.length === 0 ? <PortalNotice tone="info">{t("recipeEffectsNoOptions")}</PortalNotice> : null}
        {editable ? (
          <ol className="qosp-recipe-rows" aria-label={t("recipeEffectsTitle")}>
            {rows.map((row, index) => {
              const pick = detail.pickers.items.find((item) => item.publicId === row.itemPublicId);
              const units = detail.pickers.units.filter((unit) => !pick || pick.unitPublicIds.includes(unit.publicId));
              const saved = row.effectPublicId ? version.effects.find((effect) => effect.publicId === row.effectPublicId) : undefined;
              const savedOption = saved && !options.some((option) => option.publicId === saved.option.publicId) ? saved.option : null;
              return (
                <li key={row.key} className="qosp-subcard qosp-stack">
                  <div className="qosp-meta-row">
                    <strong className="qosp-subcard-title">{staffCopyWith(locale, "recipeEffectNumber", { number: isolateText(String(index + 1)) })}</strong>
                    {saved ? <RecipeStateBadges states={saved.states} /> : null}
                  </div>
                  <div className="qosp-form-grid" data-columns="2">
                    <PortalField label={t("recipeEffectOption")}>
                      <select className="qos-input" value={row.optionPublicId} onChange={(event) => update(index, { optionPublicId: event.target.value })}>
                        <option value="">{t("recipeEffectChooseOption")}</option>
                        {savedOption ? <option value={savedOption.publicId}>{optionText(locale, savedOption)}</option> : null}
                        {options.map((option) => (
                          <option key={option.publicId} value={option.publicId}>
                            {`${option.products.map((product) => name(locale, product).text).join(", ")} · ${optionText(locale, option)}`}
                          </option>
                        ))}
                      </select>
                    </PortalField>
                    <PortalField label={t("recipeEffectType")}>
                      <select className="qos-input" value={row.effectType} onChange={(event) => update(index, { effectType: event.target.value as EffectType })}>
                        {(["add", "remove", "replace"] as const).map((type) => (
                          <option key={type} value={type}>
                            {t(TYPE_LABEL[type])}
                          </option>
                        ))}
                      </select>
                    </PortalField>
                    {row.effectType !== "add" ? (
                      <PortalField label={t("recipeEffectTargetLine")}>
                        <select className="qos-input" value={row.targetLinePublicId} onChange={(event) => update(index, { targetLinePublicId: event.target.value })}>
                          <option value="">{t("recipeEffectChooseLine")}</option>
                          {version.lines.map((line) => (
                            <option key={line.publicId} value={line.publicId}>
                              {`${name(locale, line.item).text} · ${isolateText(`${line.quantity} ${line.unit.code}`)}`}
                            </option>
                          ))}
                        </select>
                      </PortalField>
                    ) : null}
                    {row.effectType !== "remove" ? (
                      <>
                        <PortalField label={t("recipeEffectItem")}>
                          <select className="qos-input" value={row.itemPublicId} onChange={(event) => update(index, { itemPublicId: event.target.value, unitPublicId: "" })}>
                            <option value="">{t("recipeChooseItem")}</option>
                            {detail.pickers.items.map((item) => (
                              <option key={item.publicId} value={item.publicId}>
                                {name(locale, item).text}
                              </option>
                            ))}
                          </select>
                        </PortalField>
                        <PortalField label={t("recipeEffectQuantity")}>
                          <input className="qos-input" dir="ltr" inputMode="decimal" value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
                        </PortalField>
                        <PortalField label={t("recipeLineUnit")}>
                          <select className="qos-input" value={row.unitPublicId} onChange={(event) => update(index, { unitPublicId: event.target.value })}>
                            <option value="">{t("recipeChooseUnit")}</option>
                            {units.map((unit) => (
                              <option key={unit.publicId} value={unit.publicId}>
                                {unit.code}
                              </option>
                            ))}
                          </select>
                        </PortalField>
                      </>
                    ) : null}
                    <PortalField label={t("recipeEffectNotes")}>
                      <input className="qos-input" dir="auto" maxLength={200} value={row.notes} onChange={(event) => update(index, { notes: event.target.value })} />
                    </PortalField>
                  </div>
                  {saved ? <p className="qosp-inventory-sentence">{effectSentence(locale, saved)}</p> : null}
                  <div className="qosp-button-row qosp-recipe-actions">
                    <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" onClick={() => setRows(rows.filter((_, position) => position !== index))}>
                      <Trash2 size={14} aria-hidden="true" />
                      {t("recipeEffectRemoveRow")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <ol className="qosp-recipe-rows" aria-label={t("recipeEffectsTitle")}>
            {version.effects.map((effect) => (
              <li key={effect.publicId} className="qosp-subcard qosp-stack">
                <div className="qosp-meta-row">
                  <PortalBadge tone="neutral" wrap>
                    {t(TYPE_LABEL[effect.effectType])}
                  </PortalBadge>
                  <bdi className="qosp-subcard-title" dir={name(locale, effect.option).dir}>
                    {optionText(locale, effect.option)}
                  </bdi>
                  <RecipeStateBadges states={effect.states} />
                </div>
                <p className="qosp-inventory-sentence">{effectSentence(locale, effect)}</p>
                {effect.notes ? (
                  <p className="qosp-meta-line" dir="auto">
                    {effect.notes}
                  </p>
                ) : null}
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
              disabled={options.length === 0}
              onClick={() => {
                setCounter(counter + 1);
                setRows([
                  ...rows,
                  { key: `new-${counter}`, effectPublicId: null, optionPublicId: "", effectType: "add", targetLinePublicId: "", itemPublicId: "", unitPublicId: "", quantity: "", notes: "" },
                ]);
              }}
            >
              {t("recipeEffectAdd")}
            </button>
            <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
              {t("recipeEffectsSave")}
            </button>
          </div>
        ) : null}
      </div>
    </PortalPanel>
  );
}
