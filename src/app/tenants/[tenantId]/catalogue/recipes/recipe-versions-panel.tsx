"use client";

import Link from "next/link";
import { useState } from "react";

import { RecipeStateBadges } from "@/app/tenants/[tenantId]/catalogue/recipes/recipe-states";
import {
  costSummaryText,
  lastCoveredDay,
  recipesApiPath,
  recipesPath,
  TAX_BASIS_KEY,
} from "@/app/tenants/[tenantId]/catalogue/recipes/recipes-client";
import { inventoryApi, inventoryFailureText } from "@/app/tenants/[tenantId]/inventory/inventory-client";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { PortalBadge, PortalField, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type { ApprovalEffect } from "@/lib/recipes/versions";
import type { RecipeDetailView, VersionView } from "@/lib/recipes/views";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, staffCopyWith, staffCount, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* QOS-198 current and draft versions, approval and history. Only the open
   draft can change. Approving asks for the business date the version starts
   and says exactly which dates move to it; nothing has been posted, so no past
   usage changes. Every version stays in the history. */

/** The version the lines and steps panels show: the open draft, else the current, scheduled or latest version. */
export function workingVersion(detail: RecipeDetailView): VersionView | null {
  return (
    detail.versions.find((version) => version.status === "draft") ??
    detail.versions.find((version) => version.phase === "current") ??
    detail.versions.find((version) => version.phase === "scheduled") ??
    detail.versions[0] ??
    null
  );
}

const STATUS_LABEL: Record<VersionView["status"], StaffUiCopyKey> = {
  draft: "recipeStatusDraft",
  approved: "recipeStatusApproved",
  discarded: "recipeStatusDiscarded",
};

const PHASE_LABEL: Partial<Record<VersionView["phase"], StaffUiCopyKey>> = {
  current: "recipeCurrent",
  scheduled: "recipeScheduled",
  ended: "recipeEnded",
};

export function versionRange(locale: StaffLocale, version: VersionView) {
  if (!version.effectiveFrom) return null;
  return version.effectiveTo
    ? staffCopyWith(locale, "recipeEffectiveRange", {
        from: isolateText(version.effectiveFrom),
        to: isolateText(lastCoveredDay(version.effectiveTo)),
      })
    : staffCopyWith(locale, "recipeEffectiveFrom", { date: isolateText(version.effectiveFrom) });
}

export function effectText(locale: StaffLocale, effect: Pick<ApprovalEffect, "versionNumber" | "effectiveFrom" | "supersededVersion" | "supersededCovers">) {
  if (effect.supersededVersion !== null && effect.supersededCovers) {
    return staffCopyWith(locale, "recipeApproveEffect", {
      version: isolateText(String(effect.versionNumber)),
      date: isolateText(effect.effectiveFrom),
      previous: isolateText(String(effect.supersededVersion)),
      from: isolateText(effect.supersededCovers.from),
      to: isolateText(effect.supersededCovers.to),
    });
  }
  return staffCopyWith(locale, "recipeApproveEffectFirst", {
    version: isolateText(String(effect.versionNumber)),
    date: isolateText(effect.effectiveFrom),
  });
}

export function VersionSummary({ version }: { version: VersionView }) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const range = versionRange(locale, version);
  const phase = PHASE_LABEL[version.phase];
  return (
    <div className="qosp-stack qosp-recipe-version-summary">
      <div className="qosp-meta-row">
        <strong className="qosp-subcard-title">
          {staffCopyWith(locale, "recipeVersionLabel", { number: isolateText(String(version.versionNumber)) })}
        </strong>
        <PortalBadge tone={version.status === "approved" ? "positive" : "neutral"}>{t(STATUS_LABEL[version.status])}</PortalBadge>
        {phase ? <PortalBadge tone="neutral">{t(phase)}</PortalBadge> : null}
      </div>
      {range ? <span className="qosp-meta-line">{range}</span> : null}
      <span className="qosp-meta-line">
        {version.yieldQuantity && version.yieldUnit
          ? staffCopyWith(locale, "recipeYieldLine", { quantity: isolateText(version.yieldQuantity), unit: isolateText(version.yieldUnit.code) })
          : t("recipeYieldNotSet")}
      </span>
      <span className="qosp-meta-line">
        {staffCount(locale, "recipeLines", version.lines.length)} · {staffCount(locale, "recipeSteps", version.steps.length)}
      </span>
      <span className="qosp-inventory-cost-amount">
        {version.cost.status === "known"
          ? `${costSummaryText(locale, version.cost, version.yieldUnit?.code ?? null)} · ${staffCopyWith(locale, "recipeCostTaxBasis", {
              basis: t(TAX_BASIS_KEY[version.cost.taxBasis]!),
            })}`
          : version.cost.status === "unavailable"
            ? staffCopyWith(locale, "recipeCostUnavailableLine", {
                count: staffCount(locale, "recipeLinesWithoutCost", version.cost.linesWithoutCost),
              })
            : t("recipeCostNoLines")}
      </span>
      <div className="qosp-meta-row">
        <RecipeStateBadges states={version.states} />
      </div>
    </div>
  );
}

export function RecipeVersionsPanel({
  tenantId,
  detail,
  canEdit,
  onChange,
}: {
  tenantId: string;
  detail: RecipeDetailView;
  canEdit: boolean;
  onChange: (next: RecipeDetailView) => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const draft = detail.versions.find((version) => version.status === "draft") ?? null;
  const current = detail.versions.find((version) => version.phase === "current") ?? null;
  const scheduled = detail.versions.find((version) => version.phase === "scheduled") ?? null;
  const openEnded = detail.versions.find((version) => version.status === "approved" && version.effectiveTo === null) ?? null;
  const [yieldForm, setYieldForm] = useState({
    quantity: draft?.yieldQuantity ?? "",
    unitPublicId: draft?.yieldUnit?.publicId ?? "",
    notes: draft?.notes ?? "",
  });
  const [approving, setApproving] = useState<{ effectiveFrom: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = recipesApiPath(tenantId, `/${detail.recipe.publicId}`);

  async function send<T extends RecipeDetailView>(url: string, method: string, body: unknown, success: string | ((data: T) => string)) {
    setBusy(true);
    setNotice(null);
    setDialogError(null);
    const result = await inventoryApi<T>(url, { method, body });
    setBusy(false);
    if (!result.ok) {
      const text = inventoryFailureText(locale, result);
      if (approving) setDialogError(text);
      else setNotice({ tone: "error", text });
      return false;
    }
    onChange(result.data);
    const next = result.data.versions.find((version) => version.status === "draft");
    setYieldForm({ quantity: next?.yieldQuantity ?? "", unitPublicId: next?.yieldUnit?.publicId ?? "", notes: next?.notes ?? "" });
    setNotice({ tone: "success", text: typeof success === "string" ? success : success(result.data) });
    return true;
  }

  const previewEffect = approving && draft
    ? effectText(locale, {
        versionNumber: draft.versionNumber,
        effectiveFrom: approving.effectiveFrom,
        supersededVersion: openEnded?.versionNumber ?? null,
        supersededCovers:
          openEnded?.effectiveFrom && approving.effectiveFrom
            ? { from: openEnded.effectiveFrom, to: lastCoveredDay(approving.effectiveFrom) }
            : null,
      })
    : null;

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("recipeVersionsTitle")}</h2>
      <p className="qosp-panel-help">{t("recipeApprovedReadOnly")}</p>
      <div className="qosp-panel-body qosp-stack">
        {notice ? <PortalNotice tone={notice.tone}>{notice.text}</PortalNotice> : null}
        {draft ? (
          <article className="qosp-subcard qosp-stack">
            <VersionSummary version={draft} />
            {canEdit ? (
              <>
                <div className="qosp-form-grid" data-columns="2">
                  <PortalField label={t("recipeYield")} help={t("recipeYieldHelp")}>
                    <input
                      className="qos-input"
                      dir="ltr"
                      inputMode="decimal"
                      value={yieldForm.quantity}
                      onChange={(event) => setYieldForm({ ...yieldForm, quantity: event.target.value })}
                    />
                  </PortalField>
                  <PortalField label={t("recipeYieldUnit")}>
                    <select
                      className="qos-input"
                      value={yieldForm.unitPublicId}
                      onChange={(event) => setYieldForm({ ...yieldForm, unitPublicId: event.target.value })}
                    >
                      <option value="">{t("recipeChooseUnit")}</option>
                      {detail.pickers.units.map((unit) => (
                        <option key={unit.publicId} value={unit.publicId}>
                          {`${unit.code} · ${locale === "ar" ? unit.nameAr : unit.nameEn}`}
                        </option>
                      ))}
                    </select>
                  </PortalField>
                  <PortalField label={t("recipeVersionNotes")}>
                    <textarea
                      className="qos-textarea"
                      dir="auto"
                      rows={2}
                      maxLength={1000}
                      value={yieldForm.notes}
                      onChange={(event) => setYieldForm({ ...yieldForm, notes: event.target.value })}
                    />
                  </PortalField>
                </div>
                <div className="qosp-button-row">
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    disabled={busy}
                    onClick={() =>
                      void send(`${base}/versions/${draft.publicId}`, "PATCH", {
                        expectedVersion: draft.version,
                        yieldQuantity: yieldForm.quantity.trim() || null,
                        yieldUnitPublicId: yieldForm.unitPublicId || null,
                        notes: yieldForm.notes.trim() || null,
                      }, t("recipeDraftSaved"))
                    }
                  >
                    {t("recipeSaveDraftDetails")}
                  </button>
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="primary"
                    data-size="sm"
                    disabled={busy}
                    onClick={() => {
                      setDialogError(null);
                      setApproving({ effectiveFrom: detail.today });
                    }}
                  >
                    {t("recipeApprove")}
                  </button>
                  <button type="button" className="qos-btn" data-variant="secondary" data-size="sm" disabled={busy} onClick={() => setConfirmDiscard(true)}>
                    {t("recipeDiscardDraft")}
                  </button>
                </div>
              </>
            ) : null}
          </article>
        ) : null}
        {[current, scheduled].filter((version): version is VersionView => version !== null).map((version) => (
          <article key={version.publicId} className="qosp-subcard qosp-stack">
            <VersionSummary version={version} />
            {canEdit && !draft ? (
              <div className="qosp-button-row">
                <button
                  type="button"
                  className="qos-btn"
                  data-variant="secondary"
                  data-size="sm"
                  disabled={busy}
                  onClick={() => void send(`${base}/versions`, "POST", { fromVersionPublicId: version.publicId }, t("recipeDraftCreated"))}
                >
                  {t("recipeCreateDraft")}
                </button>
              </div>
            ) : null}
          </article>
        ))}
        <details className="qosp-inventory-history" open>
          <summary>{t("recipeHistoryTitle")}</summary>
          <p className="qosp-panel-help">{t("recipeHistoryHelp")}</p>
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("recipeHistoryTitle")}>
            {detail.versions.map((version) => {
              const range = versionRange(locale, version);
              const phase = PHASE_LABEL[version.phase];
              return (
                <li key={version.publicId} className="qosp-branch-row qosp-subcard" data-columns="3">
                  <div className="qosp-branch-row-main">
                    <strong className="qosp-branch-row-name">
                      {staffCopyWith(locale, "recipeVersionLabel", { number: isolateText(String(version.versionNumber)) })}
                    </strong>
                    {range ? <span className="qosp-meta-line">{range}</span> : null}
                    {version.snapshotAt ? (
                      <span className="qosp-meta-line">
                        {staffCopyWith(locale, "recipeSnapshotLine", { date: isolateText(version.snapshotAt.slice(0, 10)) })}
                      </span>
                    ) : null}
                  </div>
                  <div className="qosp-branch-row-status">
                    <PortalBadge tone={version.status === "approved" ? "positive" : "neutral"}>{t(STATUS_LABEL[version.status])}</PortalBadge>
                    {phase ? <PortalBadge tone="neutral">{t(phase)}</PortalBadge> : null}
                  </div>
                  <div className="qosp-branch-row-status">
                    <Link
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      href={recipesPath(tenantId, `/${detail.recipe.publicId}/versions/${version.publicId}`)}
                    >
                      {t("recipeOpenVersion")}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      </div>
      <Modal
        open={approving !== null}
        size="sm"
        title={draft ? staffCopyWith(locale, "recipeApproveTitle", { number: isolateText(String(draft.versionNumber)) }) : null}
        onClose={() => setApproving(null)}
        footer={
          <>
            <button type="button" className="qos-btn" data-variant="secondary" onClick={() => setApproving(null)}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="qos-btn"
              data-variant="primary"
              disabled={busy || !approving?.effectiveFrom}
              onClick={async () => {
                if (!draft || !approving) return;
                const done = await send<RecipeDetailView & { effect: ApprovalEffect }>(
                  `${base}/versions/${draft.publicId}/approve`,
                  "POST",
                  { expectedVersion: draft.version, effectiveFrom: approving.effectiveFrom },
                  (data) => `${t("recipeApproved")} ${effectText(locale, data.effect)} ${t("recipeNoPostedUsage")}`,
                );
                if (done) setApproving(null);
              }}
            >
              {t("recipeApprove")}
            </button>
          </>
        }
      >
        {approving ? (
          <div className="qosp-stack">
            <PortalField label={t("recipeApproveDate")} help={t("recipeApproveDateHelp")}>
              <input
                className="qos-input"
                dir="ltr"
                type="date"
                value={approving.effectiveFrom}
                onChange={(event) => setApproving({ effectiveFrom: event.target.value })}
              />
            </PortalField>
            {previewEffect && approving.effectiveFrom ? <p className="qosp-inventory-sentence">{previewEffect}</p> : null}
            <p className="qosp-meta-line">{t("recipeNoPostedUsage")}</p>
            {dialogError ? <PortalNotice tone="error">{dialogError}</PortalNotice> : null}
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={confirmDiscard}
        title={t("recipeDiscardDraft")}
        description={t("recipeDiscardConfirm")}
        confirmLabel={t("recipeDiscardDraft")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          setConfirmDiscard(false);
          if (draft) void send(`${base}/versions/${draft.publicId}`, "PATCH", { expectedVersion: draft.version, status: "discarded" }, t("recipeDraftDiscarded"));
        }}
        onClose={() => setConfirmDiscard(false)}
      />
    </PortalPanel>
  );
}
