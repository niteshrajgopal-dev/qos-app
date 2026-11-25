"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";

import { RecipeStateBadges } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-states";
import { decimalText, recipesApiPath, TAX_BASIS_KEY } from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText, localName } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { PortalBadge, PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { LineView, RecipeDetailView, VersionView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 ingredient lines of the working version. Quantities are for the
   whole stated yield. On a draft, administrators pick an active item, enter
   an exact quantity in a unit the item converts to, add optional checklist
   labels, and reorder with Move up / Move down. The whole ordered list is
   saved at once; reloading shows exactly what QOS stored. Approved versions
   are read-only here. */

type Row = { key: string; linePublicId: string | null; itemPublicId: string; quantity: string; unitPublicId: string; labelEn: string; labelAr: string };

function rowsFrom(version: VersionView): Row[] {
  return version.lines.map((line) => ({
    key: line.publicId,
    linePublicId: line.publicId,
    itemPublicId: line.item.publicId,
    quantity: line.quantity,
    unitPublicId: line.unit.publicId,
    labelEn: line.labelEn ?? "",
    labelAr: line.labelAr ?? "",
  }));
}

export function RecipeLinesPanel({
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
  const saved = new Map(version.lines.map((line) => [line.publicId, line]));
  const name = (entry: { nameEn: string; nameAr: string | null }) => localName(locale, entry.nameEn, entry.nameAr);

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
      recipesApiPath(tenantId, `/${detail.recipe.publicId}/versions/${version.publicId}/lines`),
      {
        method: "PUT",
        body: {
          expectedVersion: version.version,
          lines: rows.map((row) => ({
            linePublicId: row.linePublicId,
            itemPublicId: row.itemPublicId,
            quantity: row.quantity,
            unitPublicId: row.unitPublicId,
            labelEn: row.labelEn.trim() || null,
            labelAr: row.labelAr.trim() || null,
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

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">
        {t("recipeLinesTitle")} · {staffCopyWith(locale, "recipeVersionLabel", { number: isolateText(String(version.versionNumber)) })}
      </h2>
      <p className="qosp-panel-help">{t("recipeLinesHelp")}</p>
      <div className="qosp-panel-body qosp-stack">
        {!editable && version.status !== "draft" ? <PortalNotice tone="info">{t("recipeApprovedReadOnly")}</PortalNotice> : null}
        {(editable ? rows.length : version.lines.length) === 0 ? <PortalNotice tone="info">{t("recipeLinesEmpty")}</PortalNotice> : null}
        {editable ? (
          <ol className="qosp-recipe-rows" aria-label={t("recipeLinesTitle")}>
            {rows.map((row, index) => {
              const pick = detail.pickers.items.find((item) => item.publicId === row.itemPublicId);
              const units = detail.pickers.units.filter((unit) => !pick || pick.unitPublicIds.includes(unit.publicId));
              const line = row.linePublicId ? saved.get(row.linePublicId) : undefined;
              return (
                <li key={row.key} className="qosp-subcard qosp-stack">
                  <div className="qosp-meta-row">
                    <strong className="qosp-subcard-title">{staffCopyWith(locale, "recipeLineNumber", { number: isolateText(String(index + 1)) })}</strong>
                    {pick?.kind === "prepared" ? <PortalBadge tone="neutral">{t("recipePreparedBadge")}</PortalBadge> : null}
                  </div>
                  <div className="qosp-form-grid qosp-recipe-line-grid">
                    <PortalField label={t("recipeLineItem")}>
                      <select className="qos-input" value={row.itemPublicId} onChange={(event) => update(index, { itemPublicId: event.target.value, unitPublicId: "" })}>
                        <option value="">{t("recipeChooseItem")}</option>
                        {detail.pickers.items.map((item) => (
                          <option key={item.publicId} value={item.publicId}>
                            {name(item).text}
                          </option>
                        ))}
                      </select>
                    </PortalField>
                    <PortalField label={t("recipeLineQuantity")}>
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
                    <PortalField label={t("recipeLineLabelEn")}>
                      <input className="qos-input" dir="ltr" maxLength={120} value={row.labelEn} onChange={(event) => update(index, { labelEn: event.target.value })} />
                    </PortalField>
                    <PortalField label={t("recipeLineLabelAr")}>
                      <input className="qos-input" dir="rtl" lang="ar" maxLength={120} value={row.labelAr} onChange={(event) => update(index, { labelAr: event.target.value })} />
                    </PortalField>
                  </div>
                  {line ? <LineFacts line={line} /> : null}
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
              );
            })}
          </ol>
        ) : (
          <ol className="qosp-recipe-rows" aria-label={t("recipeLinesTitle")}>
            {version.lines.map((line, index) => {
              const item = name(line.item);
              return (
                <li key={line.publicId} className="qosp-subcard qosp-stack">
                  <div className="qosp-meta-row">
                    <strong className="qosp-subcard-title">{staffCopyWith(locale, "recipeLineNumber", { number: isolateText(String(index + 1)) })}</strong>
                    <bdi dir={item.dir}>{item.text}</bdi>
                    {line.item.kind === "prepared" ? <PortalBadge tone="neutral">{t("recipePreparedBadge")}</PortalBadge> : null}
                  </div>
                  <span className="qosp-inventory-cost-amount">
                    {staffCopyWith(locale, "recipeLineQuantityLine", { quantity: isolateText(line.quantity), unit: isolateText(line.unit.code) })}
                  </span>
                  {line.labelEn || line.labelAr ? (
                    <span className="qosp-meta-line">
                      {locale === "ar" && line.labelAr ? <bdi dir="rtl">{line.labelAr}</bdi> : <bdi dir="ltr">{line.labelEn ?? line.labelAr}</bdi>}
                    </span>
                  ) : null}
                  <LineFacts line={line} />
                </li>
              );
            })}
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
                setRows([...rows, { key: `new-${counter}`, linePublicId: null, itemPublicId: "", quantity: "", unitPublicId: "", labelEn: "", labelAr: "" }]);
              }}
            >
              {t("recipeAddLine")}
            </button>
            <button type="button" className="qos-btn" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void save()}>
              {t("recipeSaveLines")}
            </button>
          </div>
        ) : null}
      </div>
    </PortalPanel>
  );
}

/** What the saved line means in the item's storage unit and what it currently costs, or why that is unknown. */
function LineFacts({ line }: { line: LineView }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  return (
    <div className="qosp-stack qosp-recipe-line-facts">
      {line.conversion.status === "ok" ? (
        <span className="qosp-meta-line qosp-inventory-cost-amount">
          {staffCopyWith(locale, "recipeLineInStorage", {
            quantity: decimalText(locale, line.conversion.inStorageUnit),
            unit: isolateText(line.conversion.storageUnitCode),
          })}
        </span>
      ) : null}
      {line.cost.status === "known" ? (
        <span className="qosp-meta-line qosp-inventory-cost-amount">
          {staffCopyWith(locale, "recipeLineCost", {
            amount: decimalText(locale, line.cost.amount),
            currency: isolateText(line.cost.currency),
            basis: t(TAX_BASIS_KEY[line.cost.taxBasis]!),
          })}
        </span>
      ) : null}
      {line.states.length > 0 ? (
        <div className="qosp-meta-row">
          <RecipeStateBadges states={line.states} />
        </div>
      ) : null}
    </div>
  );
}
