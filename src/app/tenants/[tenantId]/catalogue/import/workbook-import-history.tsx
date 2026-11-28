"use client";

import { useEffect, useState } from "react";

import { ATTEMPT_STATUS_TONE } from "@/app/tenants/[tenantId]/catalogue/import/workbook-apply-panel";
import { PortalBadge, PortalNotice, PortalPanel } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";
import type { ApplyHistoryEntry } from "@/lib/workbook/apply/model";
import { APPLY_ATTEMPT_STATUS_COPY, formatApplyTime } from "@/lib/workbook/review-view";

/* Past imports (QOS-200 follow-up): the business's latest workbook applies,
   loaded from the server each time the import page opens, so earlier
   results can be found again. Administrators only; for anyone else the
   list is not shown. "Open results" loads that plan with its per-row
   outcomes into the review panel. Held in memory only. */

const HISTORY_LIMIT = 20;

export type ImportHistoryState =
  | { status: "loading" }
  | { status: "ready"; applies: ApplyHistoryEntry[] }
  | { status: "error" }
  | { status: "hidden" };

export function WorkbookImportHistoryList({
  state,
  opening,
  onOpen,
  onRefresh,
}: {
  state: ImportHistoryState;
  /** The plan being opened, if any. */
  opening: string | null;
  onOpen: (planPublicId: string) => void;
  onRefresh: () => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  if (state.status === "hidden") return null;

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("importHistoryTitle")}</h2>
      <p className="qosp-panel-help">{t("importHistoryHelp")}</p>
      {state.status === "loading" ? <p className="qosp-meta-line">{t("importHistoryLoading")}</p> : null}
      {state.status === "error" ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="error">{t("importHistoryError")}</PortalNotice>
        </div>
      ) : null}
      {state.status === "ready" && state.applies.length === 0 ? <p className="qosp-meta-line">{t("importHistoryEmpty")}</p> : null}
      {state.status === "ready" && state.applies.length > 0 ? (
        <ol className="qosp-branch-list qosp-panel-body" aria-label={t("importHistoryTitle")}>
          {state.applies.map((entry) => (
            <li key={entry.publicId} className="qosp-subcard">
              <div className="qosp-meta-row">
                <PortalBadge tone={ATTEMPT_STATUS_TONE[entry.status]}>{t(APPLY_ATTEMPT_STATUS_COPY[entry.status])}</PortalBadge>
                <code className="qosp-code" dir="ltr">
                  {entry.publicId}
                </code>
              </div>
              <p className="qosp-meta-line" style={{ overflowWrap: "anywhere" }}>
                {staffCopyWith(locale, "importHistoryFile", { name: isolateText(entry.fileName) })}
              </p>
              <p className="qosp-meta-line">
                {staffCopyWith(locale, "applyHistoryStarted", {
                  time: isolateText(formatApplyTime(locale, entry.startedAt)),
                  actor: isolateText(entry.actorDisplayName ?? t("applyActorUnknown")),
                })}
                {" · "}
                {entry.finishedAt
                  ? staffCopyWith(locale, "applyHistoryFinished", { time: isolateText(formatApplyTime(locale, entry.finishedAt)) })
                  : t("applyHistoryRunning")}
              </p>
              <p className="qosp-meta-line">
                {staffCopyWith(locale, "applyHistoryCounts", {
                  applied: entry.counts.applied,
                  alreadyApplied: entry.counts.alreadyApplied,
                  failed: entry.counts.failed,
                  notApplied: entry.counts.notApplied,
                  deferred: entry.counts.deferredValues,
                })}
              </p>
              <div className="qosp-button-row">
                <button className="qos-btn" data-variant="secondary" type="button" disabled={opening !== null} onClick={() => onOpen(entry.planPublicId)}>
                  {opening === entry.planPublicId ? t("importHistoryOpening") : t("importHistoryOpen")}
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {state.status === "ready" && state.applies.length >= HISTORY_LIMIT ? <p className="qosp-meta-line">{t("importHistoryLatestOnly")}</p> : null}
      <div className="qosp-button-row qosp-panel-body">
        <button className="qos-btn" data-variant="secondary" type="button" disabled={state.status === "loading"} onClick={onRefresh}>
          {t("importHistoryRefresh")}
        </button>
      </div>
    </PortalPanel>
  );
}

export function WorkbookImportHistory({
  tenantId,
  refreshKey,
  onOpen,
  opening = null,
}: {
  tenantId: string;
  /** Changes when an apply finishes, so the list loads again. */
  refreshKey: number;
  onOpen: (planPublicId: string) => void;
  opening?: string | null;
}) {
  const [state, setState] = useState<ImportHistoryState>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await staffApiFetch(`/api/tenants/${tenantId}/catalogue/workbook/applies?limit=${HISTORY_LIMIT}`);
        if (cancelled) return;
        if (response.status === 403) {
          setState({ status: "hidden" });
          return;
        }
        const body = (await response.json().catch(() => null)) as { applies?: ApplyHistoryEntry[] } | null;
        if (cancelled) return;
        setState(response.ok && body?.applies ? { status: "ready", applies: body.applies } : { status: "error" });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantId, refreshKey, reload]);

  return (
    <WorkbookImportHistoryList
      state={state}
      opening={opening}
      onOpen={onOpen}
      onRefresh={() => {
        setState({ status: "loading" });
        setReload((value) => value + 1);
      }}
    />
  );
}
