"use client";

import { useState } from "react";

import {
  PortalBadge,
  PortalNotice,
  PortalStat,
  PortalStatGrid,
  type PortalBadgeTone,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";
import type { ApplyStatus } from "@/lib/workbook/apply/model";
import {
  APPLY_ATTEMPT_STATUS_COPY,
  APPLY_BLOCK_REASON_COPY,
  describeApplyApiError,
  describeReviewOwner,
  formatApplyTime,
  PLAN_STATUS_COPY,
  sheetLabel,
  summariseApplyBySheet,
  type ReviewApiError,
} from "@/lib/workbook/review-view";
import type { FieldDecision, WorkbookReviewResult } from "@/lib/workbook/validation/model";
import { WorkbookPendingSheets } from "@/app/tenants/[tenantId]/catalogue/import/workbook-pending-sheets";

/* QOS-217 apply section of the review panel. The apply button appears only
   when the server says this operator may apply this plan; otherwise the
   reason is shown in its place. Applying takes two clicks inside the panel,
   then one POST with an idempotency key held in memory: a retry after a lost
   connection resends the same key so the server replays instead of saving
   twice. Results, saved versus parsed, deferred values and the history all
   come from the plan the server returns; nothing is simulated or stored in
   the browser. */

export const ATTEMPT_STATUS_TONE: Record<ApplyStatus, PortalBadgeTone> = {
  applying: "warm",
  completed: "positive",
  failed: "danger",
  interrupted: "danger",
};

const PLAN_STATUS_TONE = { applying: "warm", applied: "positive", apply_failed: "danger" } as const;

export function WorkbookApplyPanel({
  tenantId,
  result,
  onResult,
  onRevalidate,
  busyElsewhere,
  revalidating,
}: {
  tenantId: string;
  result: WorkbookReviewResult;
  /** Called with the plan the server returns after an apply. */
  onResult: (next: WorkbookReviewResult) => void;
  /** Re-runs the review with the stored hash and the current decisions. */
  onRevalidate: () => void;
  /** True while the review panel runs a request of its own (including the revalidation). */
  busyElsewhere: boolean;
  /** True while that re-run is in flight. */
  revalidating: boolean;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Key of a request whose answer never arrived, bound to the plan hash it was sent for. */
  const [unanswered, setUnanswered] = useState<{ key: string; planHash: string } | null>(null);

  const apply = result.apply;
  const status = result.plan.status;
  const applyStatus = status === "applying" || status === "applied" || status === "apply_failed" ? status : null;
  if (!apply && !applyStatus) return null;

  const planHash = result.plan.planHash;
  const retryKey = unanswered && unanswered.planHash === planHash ? unanswered.key : null;

  const send = async () => {
    const key = retryKey ?? crypto.randomUUID();
    setUnanswered({ key, planHash });
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`/api/tenants/${tenantId}/catalogue/workbook/plans/${result.plan.publicId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ expectedPlanHash: planHash }),
      });
      // An answer arrived: whatever it says, the next click is a new request.
      setUnanswered(null);
      const body = (await response.json().catch(() => null)) as WorkbookReviewResult | ReviewApiError | null;
      if (!response.ok || !body || !("plan" in body)) {
        setError(describeApplyApiError(locale, response.status, body as ReviewApiError | null));
        return;
      }
      setConfirming(false);
      onResult(body);
    } catch {
      setError(t("applyErrorNetwork"));
    } finally {
      setBusy(false);
    }
  };

  const latest = apply?.attempts[0] ?? null;
  const showResults = (apply?.attempts.length ?? 0) > 0 || applyStatus !== null;
  const sheets = summariseApplyBySheet(result.rows);
  const deferredBySheet = new Map<string, FieldDecision[]>();
  for (const entry of result.fieldDecisions.filter((field) => field.decision === "deferred")) {
    deferredBySheet.set(entry.sheet, [...(deferredBySheet.get(entry.sheet) ?? []), entry]);
  }
  const canApply = apply?.permissions.canApply === true;
  const blockReason = apply?.permissions.reason;
  const preview = apply?.preview;

  return (
    <section aria-labelledby="workbook-apply-title">
      <div className="qosp-meta-row qosp-panel-body">
        <h3 id="workbook-apply-title" className="qosp-subcard-title">
          {t("applyTitle")}
        </h3>
        {applyStatus ? <PortalBadge tone={PLAN_STATUS_TONE[applyStatus]}>{t(PLAN_STATUS_COPY[applyStatus])}</PortalBadge> : null}
      </div>
      <p className="qosp-panel-help">{t("applyHelp")}</p>

      <div className="qosp-panel-body qosp-stack">
        {canApply ? (
          <>
            {preview ? (
              <p className="qosp-meta-line">
                {staffCopyWith(locale, "applyPreview", {
                  create: preview.create,
                  update: preview.update,
                  notApplied: preview.notApplied,
                  deferred: preview.deferredValues,
                })}
              </p>
            ) : null}
            {confirming ? <p className="qosp-meta-line">{t("applyConfirmPrompt")}</p> : null}
            <div className="qosp-button-row">
              {confirming ? (
                <>
                  <button className="qos-btn" data-variant="primary" type="button" disabled={busy || busyElsewhere} onClick={() => void send()}>
                    {busy ? t("applyButtonBusy") : retryKey ? t("applySendAgain") : t("applyConfirm")}
                  </button>
                  <button
                    className="qos-btn"
                    data-variant="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                      setError(null);
                    }}
                  >
                    {t("applyCancel")}
                  </button>
                </>
              ) : (
                <button className="qos-btn" data-variant="primary" type="button" disabled={busy || busyElsewhere} onClick={() => setConfirming(true)}>
                  {busy ? t("applyButtonBusy") : t("applyButton")}
                </button>
              )}
            </div>
          </>
        ) : blockReason ? (
          <PortalNotice tone={blockReason === "applied" ? "success" : blockReason === "apply_failed" ? "warning" : "info"}>
            {t(APPLY_BLOCK_REASON_COPY[blockReason])}
          </PortalNotice>
        ) : null}
        {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}

        {status === "apply_failed" ? (
          <>
            <div className="qosp-button-row">
              <button className="qos-btn" data-variant="secondary" type="button" disabled={busy || busyElsewhere} onClick={onRevalidate}>
                {revalidating ? t("applyRetryBusy") : t("applyRetryButton")}
              </button>
            </div>
            <p className="qosp-meta-line">{t("applyRetryHelp")}</p>
          </>
        ) : null}
      </div>

      {showResults ? (
        <>
          <h4 className="qosp-subcard-title qosp-panel-body">{t("applyResultsTitle")}</h4>
          <div className="qosp-panel-body qosp-stack">
            {result.replayed ? <PortalNotice tone="info">{t("applyReplayedNotice")}</PortalNotice> : null}
            {latest ? (
              <>
                <div className="qosp-meta-row">
                  <PortalBadge tone={ATTEMPT_STATUS_TONE[latest.status]}>{t(APPLY_ATTEMPT_STATUS_COPY[latest.status])}</PortalBadge>
                  <span className="qosp-meta-line">
                    {staffCopyWith(locale, "applyLatestMeta", { id: isolateText(latest.publicId), revision: latest.planRevision })}
                  </span>
                </div>
                <PortalStatGrid>
                  <PortalStat label={t("applyStatSaved")} value={String(latest.counts.applied)} sub={t("applyStatSavedSub")} />
                  <PortalStat label={t("applyStatAlreadySaved")} value={String(latest.counts.alreadyApplied)} sub={t("applyStatAlreadySavedSub")} />
                  <PortalStat label={t("applyStatFailed")} value={String(latest.counts.failed)} sub={t("applyStatFailedSub")} />
                  <PortalStat label={t("applyStatNotApplied")} value={String(latest.counts.notApplied)} sub={t("applyStatNotAppliedSub")} />
                  <PortalStat label={t("applyStatDeferred")} value={String(latest.counts.deferredValues)} sub={t("applyStatDeferredSub")} />
                </PortalStatGrid>
              </>
            ) : null}
            <PortalNotice tone="info">{t("applyDraftsNote")}</PortalNotice>
          </div>

          {sheets.length > 0 ? (
            <>
              <h4 className="qosp-subcard-title qosp-panel-body">{t("applySavedVsParsedTitle")}</h4>
              <p className="qosp-panel-help">{t("applySavedVsParsedHelp")}</p>
              <ul className="qosp-branch-list qosp-panel-body" aria-label={t("applySavedVsParsedTitle")}>
                {sheets.map((entry) => (
                  <li key={entry.sheet} className="qosp-subcard">
                    <p className="qosp-field-label">
                      <bdi>{sheetLabel(locale, entry.sheet)}</bdi>
                    </p>
                    <dl className="qosp-plain-list qosp-meta-row">
                      {(
                        [
                          ["applyStatSaved", entry.saved],
                          ["applyStatNotApplied", entry.notApplied],
                          ["applyStatFailed", entry.failed],
                          ["applyStatDeferred", entry.deferredValues],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="qosp-meta-line">
                          <dt className="qosp-field-label">{t(label)}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {deferredBySheet.size > 0 ? (
            <>
              <h4 className="qosp-subcard-title qosp-panel-body">{t("applyDeferredTitle")}</h4>
              <p className="qosp-panel-help">{t("applyDeferredSentence")}</p>
              <ul className="qosp-branch-list qosp-panel-body" aria-label={t("applyDeferredTitle")}>
                {[...deferredBySheet].map(([sheetName, entries]) => (
                  <li key={sheetName} className="qosp-subcard">
                    <p className="qosp-field-label">
                      <bdi>{sheetLabel(locale, sheetName)}</bdi>
                    </p>
                    <p className="qosp-panel-help">
                      <code className="qosp-code" dir="ltr">
                        {entries.map((entry) => entry.column).join(", ")}
                      </code>
                    </p>
                    <p className="qosp-meta-line">
                      {staffCopyWith(locale, "reviewFieldOwner", {
                        owner: isolateText([...new Set(entries.map((entry) => describeReviewOwner(locale, entry.owner)))].join(locale === "ar" ? "؛ " : "; ")),
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <WorkbookPendingSheets sheets={result.sheets} />

          {apply && apply.attempts.length > 0 ? (
            <>
              <h4 className="qosp-subcard-title qosp-panel-body">{t("applyHistoryTitle")}</h4>
              <ol className="qosp-branch-list qosp-panel-body" aria-label={t("applyHistoryTitle")}>
                {apply.attempts.map((attempt) => (
                  <li key={attempt.publicId} className="qosp-subcard">
                    <div className="qosp-meta-row">
                      <PortalBadge tone={ATTEMPT_STATUS_TONE[attempt.status]}>{t(APPLY_ATTEMPT_STATUS_COPY[attempt.status])}</PortalBadge>
                      <code className="qosp-code" dir="ltr">
                        {attempt.publicId}
                      </code>
                    </div>
                    <p className="qosp-meta-line">
                      {staffCopyWith(locale, "applyHistoryStarted", {
                        time: isolateText(formatApplyTime(locale, attempt.startedAt)),
                        actor: isolateText(attempt.actorSubject),
                      })}
                      {" · "}
                      {attempt.finishedAt
                        ? staffCopyWith(locale, "applyHistoryFinished", { time: isolateText(formatApplyTime(locale, attempt.finishedAt)) })
                        : t("applyHistoryRunning")}
                    </p>
                    <p className="qosp-meta-line">
                      {staffCopyWith(locale, "applyHistoryCounts", {
                        applied: attempt.counts.applied,
                        alreadyApplied: attempt.counts.alreadyApplied,
                        failed: attempt.counts.failed,
                        notApplied: attempt.counts.notApplied,
                        deferred: attempt.counts.deferredValues,
                      })}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
