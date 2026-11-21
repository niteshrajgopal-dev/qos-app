"use client";

import { useMemo, useState } from "react";

import { WorkbookApplyPanel } from "@/app/tenants/[tenantId]/catalogue/import/workbook-apply-panel";
import { WorkbookReviewRow } from "@/app/tenants/[tenantId]/catalogue/import/workbook-review-row";
import {
  PortalBadge,
  PortalField,
  PortalFilterTabs,
  PortalNotice,
  PortalPagination,
  PortalPanel,
  PortalStat,
  PortalStatGrid,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { Checkbox } from "@/design-system/components/primitives/Checkbox";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";
import { attachmentFileName } from "@/lib/workbook/import-view";
import {
  applyEditorHref,
  describeReviewApiError,
  describeReviewDiagnostic,
  filterReviewRows,
  indexReviewRows,
  PLAN_STATUS_COPY,
  REVIEW_BLOCKER_COPY,
  REVIEW_CLASSIFICATION_COPY,
  REVIEW_CLASSIFICATION_SUB_COPY,
  REVIEW_FIELD_DECISION_COPY,
  REVIEW_FILTER_COPY,
  REVIEW_FILTERS,
  reviewRowAnchor,
  type ReviewApiError,
  type ReviewFilter,
} from "@/lib/workbook/review-view";
import {
  REVIEW_CLASSIFICATIONS,
  type FieldDecision,
  type PlanAcknowledgement,
  type PlanDecision,
  type RowDecision,
  type RowRef,
  type WorkbookReviewResult,
} from "@/lib/workbook/validation/model";

/* QOS-194 review panel: the persisted review plan of an uploaded workbook.
   Header with the plan and its status, the context and mappings, counts by
   outcome, field decisions, explicit acknowledgements, and the rows with
   their before/after values and decisions. Decisions and acknowledgements
   live in this component's state until the review is re-run; nothing is
   stored in the browser. Applying (QOS-217) happens in the apply section,
   only when the server allows it, and its outcome is shown per row. */

const PAGE_SIZE = 25;
const FIELD_DECISION_TONE = { validated: "positive", deferred: "warm", rejected: "danger", mechanics: "neutral" } as const;
const PLAN_STATUS_TONE = { review_ready: "positive", stale: "danger", applying: "warm", applied: "positive", apply_failed: "danger" } as const;
const FIELD_DECISION_ORDER: Array<FieldDecision["decision"]> = ["validated", "deferred", "rejected", "mechanics"];

function rowId(ref: { sheet: string; row: number }) {
  return `${ref.sheet}\u0000${ref.row}`;
}

function decisionsOf(result: WorkbookReviewResult) {
  return new Map(result.rows.filter((row) => row.decision).map((row) => [rowId(row), row.decision!]));
}

function ackId(entry: PlanAcknowledgement) {
  return entry.kind === "acknowledge_deferred" ? `${entry.kind}\u0000${entry.sheet}\u0000${entry.column}` : entry.kind;
}

/** Every decision the operator holds now, row decisions first; used to re-run the review or to carry decisions to an edited upload. */
export function collectDecisions(rows: Map<string, RowDecision>, acknowledgements: Map<string, PlanAcknowledgement>): PlanDecision[] {
  return [...rows.values(), ...acknowledgements.values()];
}

export function WorkbookReviewPanel({
  tenantId,
  initialResult,
  onDecisionsChange,
}: {
  tenantId: string;
  initialResult: WorkbookReviewResult;
  /** Called with the operator's current decisions, so an edited upload can carry them over. */
  onDecisionsChange?: (decisions: PlanDecision[]) => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const basePath = `/api/tenants/${tenantId}/catalogue/workbook/plans`;

  const [result, setResult] = useState(initialResult);
  const [rowDecisions, setRowDecisions] = useState(() => decisionsOf(initialResult));
  const [acknowledgements, setAcknowledgements] = useState(() => new Map(initialResult.acknowledgements.given.map((entry) => [ackId(entry), entry])));
  const [filter, setFilter] = useState<ReviewFilter>(initialResult.counts.conflicting > 0 ? "needs_decision" : "all");
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<"rerun" | "revalidate" | "report" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = (next: WorkbookReviewResult) => {
    setResult(next);
    const rows = decisionsOf(next);
    const acks = new Map(next.acknowledgements.given.map((entry) => [ackId(entry), entry]));
    setRowDecisions(rows);
    setAcknowledgements(acks);
    onDecisionsChange?.(collectDecisions(rows, acks));
  };

  const updateRows = (rows: Map<string, RowDecision>) => {
    setRowDecisions(rows);
    onDecisionsChange?.(collectDecisions(rows, acknowledgements));
  };
  const updateAcks = (acks: Map<string, PlanAcknowledgement>) => {
    setAcknowledgements(acks);
    onDecisionsChange?.(collectDecisions(rowDecisions, acks));
  };

  const sent = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, decision] of decisionsOf(result)) ids.add(`${id}\u0000${JSON.stringify(decision)}`);
    for (const entry of result.acknowledgements.given) ids.add(ackId(entry));
    return ids;
  }, [result]);
  const current = new Set<string>([
    ...[...rowDecisions].map(([id, decision]) => `${id}\u0000${JSON.stringify(decision)}`),
    ...acknowledgements.keys(),
  ]);
  const unsent = [...current].filter((id) => !sent.has(id)).length + [...sent].filter((id) => !current.has(id)).length;

  const request = async (kind: "rerun" | "revalidate", run: () => Promise<Response>) => {
    setBusy(kind);
    setError(null);
    try {
      const response = await run();
      const body = (await response.json().catch(() => null)) as WorkbookReviewResult | ReviewApiError | null;
      if (!response.ok || !body || !("plan" in body)) {
        setError(describeReviewApiError(locale, response.status, body as ReviewApiError | null));
        return;
      }
      adopt(body);
    } catch {
      setError(t("workbookErrorGeneric"));
    } finally {
      setBusy(null);
    }
  };

  const rerun = () =>
    request("rerun", () =>
      staffApiFetch(`${basePath}/${result.plan.publicId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedPlanHash: result.plan.planHash, decisions: collectDecisions(rowDecisions, acknowledgements) }),
      }),
    );
  const revalidate = () => request("revalidate", () => staffApiFetch(`${basePath}/${result.plan.publicId}`));

  const downloadReport = async () => {
    setBusy("report");
    setError(null);
    try {
      const response = await staffApiFetch(`${basePath}/${result.plan.publicId}/correction-report?locale=${locale}`);
      if (!response.ok) {
        setError(describeReviewApiError(locale, response.status, (await response.json().catch(() => null)) as ReviewApiError | null));
        return;
      }
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = attachmentFileName(response.headers.get("content-disposition"), "qos-correction-report.xlsx");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch {
      setError(t("workbookErrorGeneric"));
    } finally {
      setBusy(null);
    }
  };

  const goTo = (ref: RowRef) => {
    setFilter("all");
    setSheet(ref.sheet);
    const rows = filterReviewRows(result.rows, "all", ref.sheet);
    const index = rows.findIndex((row) => row.row === ref.row);
    setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : 1);
    window.setTimeout(() => document.getElementById(reviewRowAnchor(ref))?.scrollIntoView({ block: "start" }), 0);
  };

  const context = result.context;
  const stale = result.plan.status === "stale" || result.stale === true;
  const planStatus = stale && result.plan.status === "review_ready" ? "stale" : result.plan.status;
  const applyLocked = result.plan.status === "applying" || result.plan.status === "applied";
  const nothingApplied = (result.apply?.attempts.length ?? 0) === 0 && (planStatus === "review_ready" || planStatus === "stale");
  const rowIndex = indexReviewRows(result.rows);
  const sheets = [...new Set(result.rows.map((row) => row.sheet))];
  const visible = filterReviewRows(result.rows, filter, sheet);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const channels = (context.requiredMappings ?? []).filter((mapping) => mapping.kind === "channel");

  const deferredBySheet = new Map<string, Array<{ column: string; rows: number }>>();
  for (const entry of result.acknowledgements.required) {
    if (entry.kind !== "acknowledge_deferred" || !entry.sheet || !entry.column) continue;
    deferredBySheet.set(entry.sheet, [...(deferredBySheet.get(entry.sheet) ?? []), { column: entry.column, rows: entry.rows }]);
  }
  const warnings = result.acknowledgements.required.find((entry) => entry.kind === "acknowledge_warnings");
  const partial = result.acknowledgements.required.find((entry) => entry.kind === "acknowledge_partial_apply");
  const toggleDeferredSheet = (sheetName: string, columns: string[], checked: boolean) => {
    const next = new Map(acknowledgements);
    for (const column of columns) {
      const entry: PlanAcknowledgement = { kind: "acknowledge_deferred", sheet: sheetName, column };
      if (checked) next.set(ackId(entry), entry);
      else next.delete(ackId(entry));
    }
    updateAcks(next);
  };
  const togglePlain = (kind: "acknowledge_warnings" | "acknowledge_partial_apply", checked: boolean) => {
    const next = new Map(acknowledgements);
    if (checked) next.set(kind, { kind });
    else next.delete(kind);
    updateAcks(next);
  };

  return (
    <PortalPanel>
      <h2 className="qosp-panel-title">{t("reviewTitle")}</h2>
      <div className="qosp-meta-row">
        <PortalBadge tone={PLAN_STATUS_TONE[planStatus]}>{t(PLAN_STATUS_COPY[planStatus])}</PortalBadge>
        <span className="qosp-meta-line">
          {staffCopyWith(locale, "reviewPlanMeta", { plan: isolateText(result.plan.publicId), revision: result.plan.revision })}
        </span>
      </div>
      <p className="qosp-meta-line">
        {staffCopyWith(locale, "reviewFileMeta", { name: isolateText(context.fileName) })}
        {" · "}
        {t("reviewFingerprint")}{" "}
        <code className="qosp-code" dir="ltr">
          {context.fileFingerprint.slice(0, 8)}
        </code>
      </p>
      <div className="qosp-panel-body qosp-stack">
        {nothingApplied ? <PortalNotice tone="info">{t("reviewNotApplied")}</PortalNotice> : null}
        {stale ? <PortalNotice tone="warning">{t("reviewStaleNotice")}</PortalNotice> : null}
        {result.replayed && (result.apply?.attempts.length ?? 0) === 0 ? <PortalNotice tone="info">{t("reviewReplayedNotice")}</PortalNotice> : null}
        {result.notices.map((notice) => (
          <PortalNotice key={notice.code} tone="info">
            {describeReviewDiagnostic(locale, notice)}
          </PortalNotice>
        ))}
      </div>

      <h3 className="qosp-subcard-title qosp-panel-body">{t("reviewContextTitle")}</h3>
      <dl className="qosp-plain-list qosp-panel-body qosp-stack">
        <div>
          <dt className="qosp-field-label">{t("reviewContextProfile")}</dt>
          <dd>{t(context.profile === "foodics_menu_v1" ? "reviewProfileFoodics" : "reviewProfileQos")}</dd>
        </div>
        <div>
          <dt className="qosp-field-label">{t("reviewContextTenant")}</dt>
          <dd>
            <code className="qosp-code" dir="ltr">
              {context.tenantPublicId}
            </code>
          </dd>
        </div>
        <div>
          <dt className="qosp-field-label">{t("reviewContextBrand")}</dt>
          <dd>
            <code className="qosp-code" dir="ltr">
              {context.brandPublicId}
            </code>
          </dd>
        </div>
        <div>
          <dt className="qosp-field-label">{t("reviewContextCurrency")}</dt>
          <dd>
            <code className="qosp-code" dir="ltr">
              {context.currency}
            </code>
          </dd>
        </div>
        <div>
          <dt className="qosp-field-label">{t("reviewContextNamespace")}</dt>
          <dd className="qosp-meta-row">
            <code className="qosp-code" dir="ltr">
              {context.sourceNamespace}
            </code>
            <PortalBadge tone={context.keysVerified ? "positive" : "warm"}>{t(context.keysVerified ? "reviewKeysVerified" : "reviewKeysUnverified")}</PortalBadge>
          </dd>
        </div>
        <div>
          <dt className="qosp-field-label">{t("reviewContextBranches")}</dt>
          <dd>
            {context.branchScope === "all" ? (
              t("reviewBranchScopeAll")
            ) : (
              <code className="qosp-code" dir="ltr">
                {context.branchScope.join(", ")}
              </code>
            )}
          </dd>
        </div>
        {context.exportRevision ? (
          <div>
            <dt className="qosp-field-label">{t("reviewContextExport")}</dt>
            <dd>
              <code className="qosp-code" dir="ltr">
                {context.exportRevision}
              </code>
            </dd>
          </div>
        ) : null}
      </dl>
      {channels.length > 0 ? (
        <p className="qosp-meta-line qosp-panel-body">
          {staffCopyWith(locale, "reviewChannelsDeferred", {
            channels: isolateText(channels.map((channel) => (channel.kind === "channel" ? `${channel.label} (${channel.prices})` : "")).join(", ")),
          })}
        </p>
      ) : null}
      {context.ignoredSheets && context.ignoredSheets.length > 0 ? (
        <p className="qosp-meta-line">
          {staffCopyWith(locale, "reviewIgnoredSheets", { sheets: isolateText(context.ignoredSheets.map((entry) => entry.sheet).join(", ")) })}
        </p>
      ) : null}

      <h3 className="qosp-subcard-title qosp-panel-body">{t("reviewCountsTitle")}</h3>
      <div className="qosp-panel-body">
        <PortalStatGrid>
          {REVIEW_CLASSIFICATIONS.map((classification) => (
            <PortalStat
              key={classification}
              label={t(REVIEW_CLASSIFICATION_COPY[classification])}
              value={String(result.counts[classification])}
              sub={t(REVIEW_CLASSIFICATION_SUB_COPY[classification])}
            />
          ))}
        </PortalStatGrid>
        <p className="qosp-meta-line">
          {staffCopyWith(locale, "reviewCountsSub", { deferred: result.counts.deferredValues, pending: result.counts.acknowledgementsPending })}
        </p>
        <p className="qosp-meta-line">
          {result.readiness.reviewComplete
            ? t("reviewReadinessComplete")
            : staffCopyWith(locale, "reviewReadinessOpen", {
                blockers: result.readiness.blockers.map((blocker) => t(REVIEW_BLOCKER_COPY[blocker])).join(locale === "ar" ? "، " : ", "),
              })}
        </p>
      </div>

      {result.fieldDecisions.length > 0 ? (
        <>
          <h3 className="qosp-subcard-title qosp-panel-body">{t("reviewFieldsTitle")}</h3>
          <p className="qosp-panel-help">{t("reviewFieldsHelp")}</p>
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("reviewFieldsTitle")}>
            {FIELD_DECISION_ORDER.flatMap((decision) => {
              const bySheet = new Map<string, FieldDecision[]>();
              for (const entry of result.fieldDecisions.filter((field) => field.decision === decision)) {
                bySheet.set(entry.sheet, [...(bySheet.get(entry.sheet) ?? []), entry]);
              }
              return [...bySheet].map(([sheetName, entries]) => (
                <li key={`${decision}-${sheetName}`} className="qosp-subcard">
                  <div className="qosp-meta-row">
                    <PortalBadge tone={FIELD_DECISION_TONE[decision]}>{t(REVIEW_FIELD_DECISION_COPY[decision])}</PortalBadge>
                    <bdi dir="ltr">{sheetName}</bdi>
                  </div>
                  <p className="qosp-panel-help">
                    <code className="qosp-code" dir="ltr">
                      {entries.map((entry) => entry.column).join(", ")}
                    </code>
                  </p>
                  <p className="qosp-meta-line">
                    {staffCopyWith(locale, "reviewFieldOwner", { owner: isolateText([...new Set(entries.map((entry) => entry.owner))].join("; ")) })}
                    {" · "}
                    {staffCopyWith(locale, "reviewFieldRows", { count: Math.max(...entries.map((entry) => entry.rowsWithValues)) })}
                  </p>
                </li>
              ));
            })}
          </ul>
        </>
      ) : null}

      {result.acknowledgements.required.length > 0 ? (
        <>
          <h3 className="qosp-subcard-title qosp-panel-body">{t("reviewAcksTitle")}</h3>
          <p className="qosp-panel-help">{t("reviewAcksHelp")}</p>
          <fieldset className="qosp-choice-group qosp-panel-body">
            <legend className="qosp-field-label">{t("reviewAcksTitle")}</legend>
            <div className="qosp-stack">
              {[...deferredBySheet].map(([sheetName, entries]) => {
                const columns = entries.map((entry) => entry.column);
                const checked = columns.every((column) => acknowledgements.has(ackId({ kind: "acknowledge_deferred", sheet: sheetName, column })));
                return (
                  <Checkbox
                    key={sheetName}
                    checked={checked}
                    onChange={(event) => toggleDeferredSheet(sheetName, columns, event.target.checked)}
                    label={staffCopyWith(locale, "reviewAckDeferred", { columns: isolateText(columns.join(", ")), sheet: isolateText(sheetName) })}
                  />
                );
              })}
              {warnings ? (
                <Checkbox
                  checked={acknowledgements.has("acknowledge_warnings")}
                  onChange={(event) => togglePlain("acknowledge_warnings", event.target.checked)}
                  label={staffCopyWith(locale, "reviewAckWarnings", { rows: warnings.rows })}
                />
              ) : null}
              {partial ? (
                <Checkbox
                  checked={acknowledgements.has("acknowledge_partial_apply")}
                  onChange={(event) => togglePlain("acknowledge_partial_apply", event.target.checked)}
                  label={staffCopyWith(locale, "reviewAckPartial", { rows: partial.rows })}
                />
              ) : null}
            </div>
          </fieldset>
        </>
      ) : null}

      {error ? (
        <div className="qosp-panel-body">
          <PortalNotice tone="error">{error}</PortalNotice>
        </div>
      ) : null}
      {unsent > 0 ? <p className="qosp-meta-line qosp-panel-body">{staffCopyWith(locale, "reviewUnsentDecisions", { count: unsent })}</p> : null}
      <div className="qosp-button-row qosp-panel-body">
        <button className="qos-btn" data-variant="primary" type="button" disabled={busy !== null || applyLocked} onClick={() => void rerun()}>
          {busy === "rerun" ? t("reviewRerunBusy") : t("reviewRerun")}
        </button>
        <button className="qos-btn" data-variant="secondary" type="button" disabled={busy !== null} onClick={() => void revalidate()}>
          {busy === "revalidate" ? t("reviewRevalidateBusy") : t("reviewRevalidate")}
        </button>
        <button className="qos-btn" data-variant="secondary" type="button" disabled={busy !== null} onClick={() => void downloadReport()}>
          {busy === "report" ? t("reviewDownloadReportBusy") : t("reviewDownloadReport")}
        </button>
      </div>

      <WorkbookApplyPanel
        tenantId={tenantId}
        result={result}
        onResult={adopt}
        onRevalidate={() => void rerun()}
        busyElsewhere={busy !== null}
        revalidating={busy === "rerun"}
      />

      <h3 className="qosp-subcard-title qosp-panel-body">{t("reviewRowsTitle")}</h3>
      <div className="qosp-panel-body qosp-stack">
        <PortalFilterTabs
          label={t("reviewFilterLabel")}
          tabs={REVIEW_FILTERS.map((id) => ({ id, label: t(REVIEW_FILTER_COPY[id]), count: filterReviewRows(result.rows, id, sheet).length }))}
          value={filter}
          onChange={(id) => {
            setFilter(id as ReviewFilter);
            setPage(1);
          }}
        />
        <PortalField label={t("reviewSheetFilter")}>
          <select
            className="qos-input"
            value={sheet}
            onChange={(event) => {
              setSheet(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("reviewSheetAll")}</option>
            {sheets.map((name) => (
              <option key={name} value={name} dir="ltr">
                {name}
              </option>
            ))}
          </select>
        </PortalField>
      </div>
      {pageRows.length === 0 ? (
        <p className="qosp-meta-line qosp-panel-body">{t("reviewNoRows")}</p>
      ) : (
        <ul className="qosp-branch-list qosp-panel-body" aria-label={t("reviewRowsTitle")}>
          {pageRows.map((row) => (
            <WorkbookReviewRow
              key={rowId(row)}
              row={row}
              currency={context.currency}
              editorHref={applyEditorHref(tenantId, row, rowIndex)}
              decision={rowDecisions.get(rowId(row)) ?? null}
              onDecision={(decision) => {
                const next = new Map(rowDecisions);
                if (decision) next.set(rowId(row), decision);
                else next.delete(rowId(row));
                updateRows(next);
              }}
              onGoTo={goTo}
            />
          ))}
        </ul>
      )}
      {visible.length > PAGE_SIZE ? (
        <PortalPagination page={safePage} pageCount={pageCount} pageSize={PAGE_SIZE} total={visible.length} onPageChange={setPage} />
      ) : null}
    </PortalPanel>
  );
}
