"use client";

import { useState } from "react";

import {
  PortalBadge,
  PortalField,
  PortalFileInput,
  PortalNotice,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import type {
  CatalogueImportColumnMapping,
  CatalogueImportPreviewPayload,
  CatalogueImportPreviewRow,
} from "@/db/schema";
import {
  LEGACY_MAPPING_FIELDS,
  legacyPreviewFields,
  newImportIdempotencyKey,
} from "@/lib/catalogue/catalogue-import-request";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";

/* Current flat catalogue profile: preview a CSV or first-worksheet XLSX,
   adjust the suggested column mapping, then apply validated draft rows.
   The preview and apply APIs are unchanged. */

type PreviewResponse = {
  operationPublicId: string;
  previewHash: string;
  warnings: string[];
  headers: string[];
  suggestedMapping: CatalogueImportColumnMapping;
  preview: CatalogueImportPreviewPayload;
  replayed?: boolean;
};

type ApplyResponse = {
  operationPublicId: string;
  replayed: boolean;
  report: {
    createCount: number;
    updateCount: number;
    unchangedCount: number;
    skippedCount: number;
    conflictCount: number;
    errorCount: number;
  };
};

const FIELD_COPY: Record<(typeof LEGACY_MAPPING_FIELDS)[number], StaffUiCopyKey> = {
  sourceId: "importFieldSourceId",
  internalName: "importFieldInternalName",
  displayNameEn: "importFieldDisplayNameEn",
  displayNameAr: "importFieldDisplayNameAr",
  amountMinor: "importFieldAmountMinor",
  currency: "importFieldCurrency",
};

const ROW_STATUS_COPY: Record<CatalogueImportPreviewRow["status"], StaffUiCopyKey> = {
  create: "importRowStatusCreate",
  update: "importRowStatusUpdate",
  unchanged: "importRowStatusUnchanged",
  duplicate: "importRowStatusDuplicate",
  error: "importRowStatusError",
};

const ROW_STATUS_TONE = {
  create: "positive",
  update: "warm",
  unchanged: "neutral",
  duplicate: "danger",
  error: "danger",
} as const;

type CatalogueImportPanelProps = {
  tenantId: string;
};

export function CatalogueImportPanel({ tenantId }: CatalogueImportPanelProps) {
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const [connectionKey, setConnectionKey] = useState("quotes.synthetic");
  const [file, setFile] = useState<File | null>(null);
  // Null until the server has read this file's headers and suggested a mapping.
  const [columnMapping, setColumnMapping] = useState<CatalogueImportColumnMapping | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applyKey, setApplyKey] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  const basePath = `/api/tenants/${tenantId}/catalogue/import`;

  const chooseFile = (next: File) => {
    setFile(next);
    setColumnMapping(null);
    setHeaders([]);
    setPreview(null);
    setApplyKey(null);
    setApplyResult(null);
    setError(null);
  };

  const runPreview = async () => {
    if (!file) {
      setError({ title: t("importChooseFileFirst") });
      return;
    }

    setBusy(true);
    setError(null);
    setApplyResult(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      for (const [name, value] of legacyPreviewFields({ connectionKey, mapping: columnMapping })) {
        formData.set(name, value);
      }

      const response = await staffApiFetch(`${basePath}/preview`, {
        method: "POST",
        headers: { "Idempotency-Key": newImportIdempotencyKey() },
        body: formData,
      });
      const payload = (await response.json()) as PreviewResponse & { error?: string };

      if (!response.ok) {
        setError({ title: t("importPreviewFailed"), detail: payload.error });
        return;
      }

      setPreview(payload);
      setApplyKey(newImportIdempotencyKey());
      setHeaders(payload.headers);
      setColumnMapping((current) => current ?? payload.suggestedMapping);
    } catch {
      setError({ title: t("importPreviewFailed") });
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!preview || !applyKey) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(`${basePath}/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": applyKey,
        },
        body: JSON.stringify({
          operationPublicId: preview.operationPublicId,
          previewHash: preview.previewHash,
        }),
      });
      const payload = (await response.json()) as ApplyResponse & { error?: string };

      if (!response.ok) {
        setError({ title: t("importApplyFailed"), detail: payload.error });
        return;
      }

      setApplyResult(payload);
    } catch {
      setError({ title: t("importApplyFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qosp-stack">
      <PortalPanel>
        <p className="qosp-panel-help">{t("importCurrentHelp")}</p>
        <div className="qosp-button-row qosp-panel-body">
          <a className="qos-btn" data-variant="secondary" data-size="sm" href={`${basePath}/sample?format=csv`}>
            {t("importDownloadSampleCsv")}
          </a>
          <a className="qos-btn" data-variant="secondary" data-size="sm" href={`${basePath}/sample?format=xlsx`}>
            {t("importDownloadSampleXlsx")}
          </a>
        </div>
      </PortalPanel>

      <PortalPanel>
        <div className="qosp-form-grid" data-columns="2">
          <PortalField label={t("importConnectionKey")} help={t("importConnectionKeyHelp")}>
            <input
              className="qos-input"
              dir="ltr"
              value={connectionKey}
              onChange={(event) => setConnectionKey(event.target.value)}
              placeholder="quotes.synthetic"
            />
          </PortalField>
          <div className="qosp-field">
            <span className="qosp-field-label">{t("importFile")}</span>
            <PortalFileInput accept=".csv,.xlsx" disabled={busy} fileName={file?.name ?? null} onFile={chooseFile} />
          </div>
        </div>

        {columnMapping && headers.length > 0 ? (
          <div className="qosp-panel-body">
            <h2 className="qosp-panel-title">{t("importColumnMapping")}</h2>
            <p className="qosp-panel-help">{t("importColumnMappingHelp")}</p>
            <div className="qosp-form-grid qosp-panel-body" data-columns="2">
              {LEGACY_MAPPING_FIELDS.map((field) => (
                <PortalField key={field} label={t(FIELD_COPY[field])}>
                  <select
                    className="qos-input"
                    dir="ltr"
                    value={columnMapping[field]}
                    onChange={(event) => {
                      setColumnMapping({ ...columnMapping, [field]: event.target.value });
                      // A changed mapping needs a new preview before anything can be applied.
                      setPreview(null);
                      setApplyKey(null);
                    }}
                  >
                    <option value="">{t("importSelectColumn")}</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </PortalField>
              ))}
            </div>
          </div>
        ) : null}

        <div className="qosp-button-row qosp-panel-body">
          <button
            className="qos-btn"
            data-variant="primary"
            disabled={busy || !file}
            onClick={() => void runPreview()}
            type="button"
          >
            {busy ? t("importWorking") : t("importPreview")}
          </button>
          <button
            className="qos-btn"
            data-variant="secondary"
            disabled={busy || !preview}
            onClick={() => void runApply()}
            type="button"
          >
            {t("importApply")}
          </button>
        </div>
      </PortalPanel>

      {error ? (
        <PortalNotice tone="error">
          {error.title}
          {error.detail ? (
            <>
              {" "}
              {t("importServerDetail")} <bdi dir="ltr">{error.detail}</bdi>
            </>
          ) : null}
        </PortalNotice>
      ) : null}

      {preview ? (
        <PortalPanel>
          <h2 className="qosp-panel-title">{t("importPreviewTitle")}</h2>
          <p className="qosp-panel-help">
            {staffCopyWith(locale, "importPreviewSummary", {
              create: preview.preview.createCount,
              update: preview.preview.updateCount,
              unchanged: preview.preview.unchangedCount,
              error: preview.preview.errorCount,
              duplicate: preview.preview.duplicateCount,
            })}
          </p>
          {preview.warnings.length > 0 ? (
            <ul className="qosp-plain-list qosp-panel-body">
              {preview.warnings.map((warning) => (
                <li key={warning}>
                  <PortalNotice tone="warning">
                    <bdi dir="ltr">{warning}</bdi>
                  </PortalNotice>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importPreviewTitle")}>
            {preview.preview.rows.map((row) => (
              <li key={`${row.sourceRow}-${row.sourceId}`} className="qosp-branch-row qosp-subcard">
                <div className="qosp-branch-row-main">
                  <span className="qosp-branch-row-label">
                    {t("importColumnRow")} {row.sourceRow}
                  </span>
                  <strong className="qosp-branch-row-name">{row.displayNameEn ?? "—"}</strong>
                  <span dir="rtl" lang="ar">
                    {row.displayNameAr ?? "—"}
                  </span>
                </div>
                <div className="qosp-branch-row-main">
                  <span className="qosp-branch-row-label">{t("importColumnSourceId")}</span>
                  <code className="qosp-code" dir="ltr">
                    {row.sourceId}
                  </code>
                </div>
                <div className="qosp-branch-row-main">
                  <span className="qosp-branch-row-label">{t("importColumnPrice")}</span>
                  <span dir="ltr">
                    {row.amountMinor != null ? `${row.amountMinor} ${row.currency ?? ""}` : "—"}
                  </span>
                  {row.reason ? (
                    <>
                      <span className="qosp-branch-row-label">{t("importColumnReason")}</span>
                      <bdi dir="ltr">{row.reason}</bdi>
                    </>
                  ) : null}
                </div>
                <div className="qosp-branch-row-status">
                  <span className="qosp-branch-row-label">{t("importColumnStatus")}</span>
                  <PortalBadge tone={ROW_STATUS_TONE[row.status]}>{t(ROW_STATUS_COPY[row.status])}</PortalBadge>
                </div>
              </li>
            ))}
          </ul>
        </PortalPanel>
      ) : null}

      {applyResult ? (
        <PortalPanel>
          <h2 className="qosp-panel-title">{t("importApplyTitle")}</h2>
          {applyResult.replayed ? <PortalNotice tone="info">{t("importApplyReplayed")}</PortalNotice> : null}
          <p className="qosp-panel-help">
            {staffCopyWith(locale, "importApplySummary", {
              create: applyResult.report.createCount,
              update: applyResult.report.updateCount,
              unchanged: applyResult.report.unchangedCount,
              skipped: applyResult.report.skippedCount,
              conflict: applyResult.report.conflictCount,
              error: applyResult.report.errorCount,
            })}
          </p>
        </PortalPanel>
      ) : null}
    </div>
  );
}
