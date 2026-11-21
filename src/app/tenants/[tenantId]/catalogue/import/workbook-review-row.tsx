"use client";

import { PortalBadge, type PortalBadgeTone } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { Radio } from "@/design-system/components/primitives/Radio";
import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";
import { WORKBOOK_SEVERITY_COPY } from "@/lib/workbook/import-view";
import {
  describeReviewDiagnostic,
  diagnosticLocation,
  formatReviewValue,
  REVIEW_CLASSIFICATION_COPY,
  REVIEW_OPERATION_COPY,
  reviewRowAnchor,
  rowLocation,
} from "@/lib/workbook/review-view";
import type { ReviewClassification, ReviewRow, RowDecision, RowRef } from "@/lib/workbook/validation/model";

/* QOS-194: one reviewed row. Shows where it is in the workbook, its readable
   name and stable key, the real before → after values, values kept for
   later (tax with its source text), notes with the cell to correct, what it
   blocks or waits for, and the decision controls for a conflicting row. A
   decision only changes the plan when the review is re-run; nothing here
   applies anything. */

export const CLASSIFICATION_TONE: Record<ReviewClassification, PortalBadgeTone> = {
  create: "positive",
  update: "positive",
  unchanged: "neutral",
  skipped: "neutral",
  conflicting: "warm",
  invalid: "danger",
  blocked: "danger",
  unsupported: "neutral",
};

const SEVERITY_TONE = { error: "danger", warning: "warm", info: "neutral" } as const;

type DecisionKind = RowDecision["kind"];

const DECISION_LABEL: Record<DecisionKind, StaffUiCopyKey> = {
  match_existing: "reviewDecisionMatchExisting",
  create_new: "reviewDecisionCreateNew",
  use_linked_record: "reviewDecisionUseLinked",
  accept_current_revision: "reviewDecisionAcceptRevision",
  exclude: "reviewDecisionExclude",
};

/** Decisions that make sense for a row, from its outcome and notes. */
export function decisionChoices(row: ReviewRow): DecisionKind[] {
  if (row.classification === "unsupported") return [];
  const codes = new Set(row.diagnostics.map((diagnostic) => diagnostic.code));
  const choices: DecisionKind[] = [];
  const hasCandidates = (row.candidates ?? []).some((candidate) => candidate.kind !== "linked");
  const decided = row.decision?.kind;
  if (hasCandidates || decided === "match_existing") choices.push("match_existing");
  if (codes.has("key_already_linked") || decided === "use_linked_record") choices.push("use_linked_record");
  if (
    codes.has("name_collision") ||
    codes.has("key_already_linked") ||
    codes.has("duplicate_name_in_workbook") ||
    codes.has("variant_target_required") ||
    decided === "create_new"
  ) {
    choices.push("create_new");
  }
  if (codes.has("stale_revision") || decided === "accept_current_revision") choices.push("accept_current_revision");
  choices.push("exclude");
  return choices;
}

export function WorkbookReviewRow({
  row,
  currency,
  decision,
  onDecision,
  onGoTo,
}: {
  row: ReviewRow;
  currency: string;
  /** The decision as the operator has it now (possibly not sent yet). */
  decision: RowDecision | null;
  onDecision: (decision: RowDecision | null) => void;
  onGoTo: (ref: RowRef) => void;
}) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const label = (locale === "ar" ? row.label.ar || row.label.en : row.label.en || row.label.ar) || row.key;
  const choices = decisionChoices(row);
  const name = `${reviewRowAnchor(row)}-decision`;
  const matchable = (row.candidates ?? []).filter((candidate) => candidate.kind !== "linked");
  const choose = (kind: DecisionKind | null) => {
    if (!kind) return onDecision(null);
    const base = { sheet: row.sheet, row: row.row, key: row.key };
    if (kind === "match_existing") {
      const target = decision?.kind === "match_existing" ? decision.targetPublicId : matchable[0]?.publicId ?? row.identity.targetPublicId ?? "";
      return onDecision({ kind, ...base, targetPublicId: target });
    }
    return onDecision({ kind, ...base });
  };

  return (
    <li id={reviewRowAnchor(row)} className="qosp-subcard">
      <div className="qosp-meta-row">
        <PortalBadge tone={CLASSIFICATION_TONE[row.classification]}>{t(REVIEW_CLASSIFICATION_COPY[row.classification])}</PortalBadge>
        {row.operation && row.operation !== row.classification ? <PortalBadge tone="neutral">{t(REVIEW_OPERATION_COPY[row.operation])}</PortalBadge> : null}
        <code className="qosp-code" dir="ltr">
          {rowLocation(row)}
        </code>
      </div>
      <p className="qosp-subcard-title">
        <bdi>{label}</bdi>
      </p>
      <dl className="qosp-plain-list qosp-panel-help">
        <div>
          <dt className="qosp-field-label">{t("reviewRowKey")}</dt>
          <dd>
            <code className="qosp-code" dir="ltr">
              {row.key}
            </code>
          </dd>
        </div>
        {row.identity.targetPublicId ? (
          <div>
            <dt className="qosp-field-label">{t("reviewRowTarget")}</dt>
            <dd>
              <code className="qosp-code" dir="ltr">
                {row.identity.targetPublicId}
              </code>
            </dd>
          </div>
        ) : null}
        {row.branch ? (
          <div>
            <dt className="qosp-field-label">{t("reviewRowBranch")}</dt>
            <dd>
              <bdi>{row.branch.name || row.branch.publicId}</bdi>
            </dd>
          </div>
        ) : null}
        {row.requestedAction ? (
          <div>
            <dt className="qosp-field-label">{t("reviewRowAction")}</dt>
            <dd>
              <code className="qosp-code" dir="ltr">
                {row.requestedAction}
              </code>
            </dd>
          </div>
        ) : null}
      </dl>

      {row.changes.length > 0 ? (
        <>
          <h4 className="qosp-field-label qosp-panel-body">{t("reviewRowChanges")}</h4>
          <ul className="qosp-diff" aria-label={t("reviewRowChanges")}>
            {row.changes.map((change) => (
              <li key={change.column} data-kind={change.after === null ? "removed" : "added"}>
                <span dir="ltr">{change.column}</span>
                {": "}
                <bdi>{formatReviewValue(locale, currency, change.column, change.before) ?? t("reviewRowNew")}</bdi>
                {" → "}
                <bdi>{formatReviewValue(locale, currency, change.column, change.after) ?? t("reviewRowCleared")}</bdi>
                {change.cell ? (
                  <>
                    {" "}
                    <span dir="ltr">({change.cell})</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : row.classification === "unchanged" ? (
        <p className="qosp-meta-line">{t("reviewRowNoChanges")}</p>
      ) : null}

      {row.deferredFields.length > 0 ? (
        <>
          <h4 className="qosp-field-label qosp-panel-body">{t("reviewRowDeferred")}</h4>
          <ul className="qosp-plain-list qosp-panel-help">
            {row.deferredFields.map((field) => (
              <li key={field.column}>
                <code className="qosp-code" dir="ltr">
                  {field.column}
                </code>{" "}
                {field.display?.basisPoints !== undefined ? (
                  staffCopyWith(locale, "reviewTaxDisplay", {
                    source: isolateText(field.display.sourceText),
                    basisPoints: field.display.basisPoints,
                    percent: isolateText(field.display.percentDisplay ?? ""),
                  })
                ) : (
                  <bdi>{field.value}</bdi>
                )}{" "}
                <PortalBadge tone="warm">{staffCopyWith(locale, "reviewFieldOwner", { owner: isolateText(field.owner) })}</PortalBadge>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {row.diagnostics.length > 0 ? (
        <>
          <h4 className="qosp-field-label qosp-panel-body">{t("reviewRowNotes")}</h4>
          <ul className="qosp-plain-list qosp-stack">
            {row.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${diagnostic.column ?? ""}-${index}`}>
                <div className="qosp-meta-row">
                  <PortalBadge tone={SEVERITY_TONE[diagnostic.severity]}>{t(WORKBOOK_SEVERITY_COPY[diagnostic.severity])}</PortalBadge>
                  <code className="qosp-code" dir="ltr">
                    {diagnosticLocation(row, diagnostic)}
                  </code>
                </div>
                <p className="qosp-panel-help">{describeReviewDiagnostic(locale, diagnostic)}</p>
                {diagnostic.responsible ? (
                  <button className="qos-btn" data-variant="ghost" type="button" onClick={() => onGoTo(diagnostic.responsible!)}>
                    {t("reviewRowGoTo")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {row.dependencies.blockedBy.length > 0 || row.dependencies.blocks.length > 0 ? (
        <p className="qosp-meta-line">
          {row.dependencies.blockedBy.length > 0 ? staffCopyWith(locale, "reviewRowBlockedBy", { count: row.dependencies.blockedBy.length }) : null}
          {row.dependencies.blockedBy.length > 0 && row.dependencies.blocks.length > 0 ? " · " : null}
          {row.dependencies.blocks.length > 0 ? staffCopyWith(locale, "reviewRowBlocks", { count: row.dependencies.blocks.length }) : null}
        </p>
      ) : null}

      {row.candidates && row.candidates.length > 0 ? (
        <>
          <h4 className="qosp-field-label qosp-panel-body">{t("reviewRowCandidates")}</h4>
          <ul className="qosp-plain-list qosp-panel-help">
            {row.candidates.map((candidate) => (
              <li key={candidate.publicId}>
                <bdi>{(locale === "ar" ? candidate.label.ar || candidate.label.en : candidate.label.en || candidate.label.ar) || candidate.publicId}</bdi>{" "}
                <code className="qosp-code" dir="ltr">
                  {candidate.publicId}
                </code>
                {candidate.detail ? (
                  <>
                    {" "}
                    <code className="qosp-code" dir="ltr">
                      {candidate.detail}
                    </code>
                  </>
                ) : null}
                {candidate.variantCount !== undefined ? <> {staffCopyWith(locale, "reviewCandidateVariants", { count: candidate.variantCount })}</> : null}
                {candidate.isDefault ? (
                  <>
                    {" "}
                    <PortalBadge tone="neutral">{t("reviewCandidateDefault")}</PortalBadge>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {row.acknowledgedCollision ? <p className="qosp-meta-line">{t("reviewDecisionAcknowledged")}</p> : null}

      {choices.length > 0 ? (
        <fieldset className="qosp-choice-group qosp-panel-body">
          <legend className="qosp-field-label">{t("reviewDecisionTitle")}</legend>
          <div className="qosp-stack">
            <Radio name={name} label={t("reviewDecisionNone")} checked={decision === null} onChange={() => choose(null)} />
            {choices.map((kind) => (
              <Radio key={kind} name={name} label={t(DECISION_LABEL[kind])} checked={decision?.kind === kind} onChange={() => choose(kind)} />
            ))}
            {decision?.kind === "match_existing" && matchable.length > 0 ? (
              <label className="qosp-field">
                <span className="qosp-field-label">{t("reviewDecisionChooseCandidate")}</span>
                <select
                  className="qos-input"
                  dir="ltr"
                  value={decision.targetPublicId}
                  onChange={(event) => onDecision({ ...decision, targetPublicId: event.target.value })}
                >
                  {matchable.map((candidate) => (
                    <option key={candidate.publicId} value={candidate.publicId}>
                      {candidate.publicId}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </fieldset>
      ) : null}
    </li>
  );
}
