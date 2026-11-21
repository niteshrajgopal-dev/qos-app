"use client";

import { useState } from "react";

import { usePortalShell } from "@/components/portal/portal-shell-context";
import {
  PortalBadge,
  type PortalBadgeTone,
  PortalField,
  PortalFileInput,
  PortalNotice,
  PortalPanel,
  PortalStat,
  PortalStatGrid,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { branchSelectionName, isolateText } from "@/lib/staff/branch-copy";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffCopyWith, staffUiCopy, type StaffUiCopyKey } from "@/lib/staff/locale";
import type { WorkbookSheetSupport } from "@/lib/workbook/contract";
import {
  attachmentFileName,
  describeWorkbookApiError,
  describeWorkbookIssue,
  WORKBOOK_SEVERITY_COPY,
  WORKBOOK_SUPPORT_COPY,
  workbookIssueLocation,
  type WorkbookApiError,
} from "@/lib/workbook/import-view";
import type { WorkbookIssue, WorkbookParseResult } from "@/lib/workbook/reader";

/* QOS workbook profile (QOS-193): download the blank 31-sheet template or a
   current-record export, and read an uploaded file. Reading is stateless:
   the result lists what QOS found and how each sheet is classified, and
   says plainly that nothing has been imported. Review and apply are later
   leaves (QOS-194, QOS-200). */

const SUPPORT_TONE: Record<WorkbookSheetSupport, PortalBadgeTone> = {
  supported: "positive",
  deferred: "warm",
  rejected: "danger",
  separate_profile: "neutral",
};

const SEVERITY_TONE: Record<WorkbookIssue["severity"], PortalBadgeTone> = {
  error: "danger",
  warning: "warm",
  info: "neutral",
};

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;
const MAX_ISSUES_SHOWN = 50;

type BrandChoice = { publicId: string; name: string };

export function WorkbookImportPanel({
  tenantId,
  onUseCurrentProfile,
}: {
  tenantId: string;
  onUseCurrentProfile: () => void;
}) {
  const { branch } = usePortalShell();
  const { locale } = useStaffLocale();
  const t = (key: StaffUiCopyKey) => staffUiCopy(locale, key);
  const basePath = `/api/tenants/${tenantId}/catalogue/workbook`;

  const [downloading, setDownloading] = useState<"template" | "export" | null>(null);
  const [brands, setBrands] = useState<BrandChoice[] | null>(null);
  const [brand, setBrand] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<WorkbookParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const branchName =
    branch.status === "ready"
      ? (branchSelectionName(locale, branch.selection, branch.branches) ?? t("noBranches"))
      : t(branch.status === "error" ? "branchUnavailable" : "branchLoading");

  const download = async (kind: "template" | "export") => {
    setDownloading(kind);
    setError(null);
    try {
      const search = new URLSearchParams();
      if (kind === "export") {
        if (branch.status === "ready" && branch.selection) search.set("branch", branch.selection);
        if (brand) search.set("brand", brand);
      }
      const query = search.toString();
      const response = await staffApiFetch(`${basePath}/${kind}${query ? `?${query}` : ""}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as (WorkbookApiError & { brands?: BrandChoice[] }) | null;
        if (body?.code === "brand_required" && body.brands) {
          setBrands(body.brands);
        }
        setError(describeWorkbookApiError(locale, response.status, body));
        return;
      }

      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = attachmentFileName(response.headers.get("content-disposition"), `qos-${kind}.xlsx`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch {
      setError(t("workbookErrorGeneric"));
    } finally {
      setDownloading(null);
    }
  };

  const readFile = async () => {
    if (!file) {
      setError(t("workbookErrorFileRequired"));
      return;
    }
    setReading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await staffApiFetch(`${basePath}/parse`, { method: "POST", body: formData });
      const body = (await response.json().catch(() => null)) as WorkbookParseResult | WorkbookApiError | null;
      if (!response.ok || !body || !("profile" in body)) {
        setError(describeWorkbookApiError(locale, response.status, body as WorkbookApiError | null));
        return;
      }
      setResult(body);
    } catch {
      setError(t("workbookErrorGeneric"));
    } finally {
      setReading(false);
    }
  };

  const issues =
    result?.profile === "qos_extended_v1"
      ? [...result.issues, ...result.sheets.flatMap((sheet) => sheet.issues)].sort(
          (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
        )
      : [];
  const listedSheets =
    result?.profile === "qos_extended_v1"
      ? result.sheets.filter((sheet) => sheet.rowCount > 0 || sheet.issues.length > 0)
      : [];

  return (
    <div className="qosp-stack">
      <PortalPanel>
        <p className="qosp-panel-help">{t("importWorkbookHelp")}</p>
        <div className="qosp-panel-body">
          <PortalNotice tone="info">{t("importWorkbookNotApplied")}</PortalNotice>
        </div>
        <div className="qosp-form-grid qosp-panel-body" data-columns="2">
          <div className="qosp-field">
            <button
              className="qos-btn"
              data-variant="secondary"
              type="button"
              disabled={downloading !== null}
              onClick={() => void download("template")}
            >
              {downloading === "template" ? t("importDownloading") : t("importDownloadTemplate")}
            </button>
            <span className="qosp-field-help">{t("importDownloadTemplateHelp")}</span>
          </div>
          <div className="qosp-field">
            <button
              className="qos-btn"
              data-variant="secondary"
              type="button"
              disabled={downloading !== null || (brands !== null && !brand)}
              onClick={() => void download("export")}
            >
              {downloading === "export" ? t("importDownloading") : t("importExportRecords")}
            </button>
            <span className="qosp-field-help">
              {staffCopyWith(locale, "importExportHelp", { branch: isolateText(branchName) })}
            </span>
          </div>
          {brands ? (
            <PortalField label={t("importBrandLabel")} help={t("importBrandRequired")}>
              <select className="qos-input" value={brand} onChange={(event) => setBrand(event.target.value)}>
                <option value="">{t("importBrandLabel")}</option>
                {brands.map((choice) => (
                  <option key={choice.publicId} value={choice.publicId}>
                    {choice.name}
                  </option>
                ))}
              </select>
            </PortalField>
          ) : null}
        </div>
      </PortalPanel>

      <PortalPanel>
        <div className="qosp-field">
          <span className="qosp-field-label">{t("importWorkbookFile")}</span>
          <PortalFileInput
            accept=".xlsx,.csv"
            disabled={reading}
            fileName={file?.name ?? null}
            onFile={(next) => {
              setFile(next);
              setResult(null);
              setError(null);
            }}
          />
        </div>
        <div className="qosp-button-row qosp-panel-body">
          <button
            className="qos-btn"
            data-variant="primary"
            type="button"
            disabled={reading || !file}
            onClick={() => void readFile()}
          >
            {reading ? t("importReading") : t("importReadFile")}
          </button>
        </div>
      </PortalPanel>

      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}

      {result?.profile === "legacy_flat" ? (
        <PortalPanel>
          <PortalNotice tone="info">
            {staffCopyWith(locale, "importLegacyDetected", { rows: result.rowCount })}
          </PortalNotice>
          <div className="qosp-button-row qosp-panel-body">
            <button className="qos-btn" data-variant="secondary" type="button" onClick={onUseCurrentProfile}>
              {t("importUseCurrentProfile")}
            </button>
          </div>
        </PortalPanel>
      ) : null}

      {result?.profile === "qos_extended_v1" ? (
        <PortalPanel>
          <h2 className="qosp-panel-title">{t("importResultTitle")}</h2>
          <p className="qosp-meta-line">
            {staffCopyWith(locale, "importResultFile", { name: isolateText(result.fileName) })}
            {" · "}
            {staffCopyWith(locale, "importResultVersion", { version: result.templateVersion })}
          </p>
          <p className="qosp-meta-line">
            {result.isExport
              ? staffCopyWith(locale, "importResultExport", {
                  date: isolateText(result.manifest.exported_at),
                  tenant: isolateText(result.manifest.tenant_public_id),
                  brand: isolateText(result.manifest.brand_public_id),
                })
              : t("importResultBlank")}
          </p>
          <div className="qosp-panel-body">
            <PortalNotice tone="info">{t("importWorkbookNotApplied")}</PortalNotice>
          </div>

          <div className="qosp-panel-body">
            <PortalStatGrid>
              <PortalStat
                label={t("importStatReady")}
                value={String(result.summary.supported.rows)}
                sub={t("importStatReadySub")}
              />
              <PortalStat
                label={t("importStatDeferred")}
                value={String(result.summary.deferred.rows + result.summary.separate_profile.rows)}
                sub={t("importStatDeferredSub")}
              />
              <PortalStat
                label={t("importStatRejected")}
                value={String(result.summary.rejected.rows)}
                sub={t("importStatRejectedSub")}
              />
              <PortalStat
                label={t("importStatAttention")}
                value={String(result.summary.errors + result.summary.warnings)}
                sub={t("importStatAttentionSub")}
              />
            </PortalStatGrid>
          </div>

          {listedSheets.length > 0 ? (
            <>
              <h3 className="qosp-subcard-title">{t("importSheetsTitle")}</h3>
              <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importSheetsTitle")}>
                {listedSheets.map((sheet) => (
                  <li key={sheet.table} className="qosp-branch-row qosp-subcard">
                    <div className="qosp-branch-row-main">
                      <span className="qosp-branch-row-label">{t("importColumnSheet")}</span>
                      <bdi className="qosp-branch-row-name" dir="ltr">
                        {sheet.sheet}
                      </bdi>
                    </div>
                    <div className="qosp-branch-row-main">
                      <span className="qosp-branch-row-label">{t("importColumnRows")}</span>
                      <span>{sheet.present ? sheet.rowCount : t("importSheetNotInFile")}</span>
                    </div>
                    <div className="qosp-branch-row-main">
                      <span className="qosp-branch-row-label">{t("importColumnIssues")}</span>
                      <span>{sheet.issues.length}</span>
                    </div>
                    <div className="qosp-branch-row-status">
                      <PortalBadge tone={SUPPORT_TONE[sheet.support]}>{t(WORKBOOK_SUPPORT_COPY[sheet.support])}</PortalBadge>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {issues.length > 0 ? (
            <>
              <h3 className="qosp-subcard-title qosp-panel-body">{t("importIssuesTitle")}</h3>
              <ul className="qosp-branch-list qosp-panel-body" aria-label={t("importIssuesTitle")}>
                {issues.slice(0, MAX_ISSUES_SHOWN).map((issue, index) => (
                  <li key={`${issue.code}-${issue.sheet ?? ""}-${issue.row ?? ""}-${issue.column ?? ""}-${index}`} className="qosp-subcard">
                    <div className="qosp-meta-row">
                      <PortalBadge tone={SEVERITY_TONE[issue.severity]}>{t(WORKBOOK_SEVERITY_COPY[issue.severity])}</PortalBadge>
                      {workbookIssueLocation(issue) ? (
                        <code className="qosp-code" dir="ltr">
                          {workbookIssueLocation(issue)}
                        </code>
                      ) : null}
                    </div>
                    <p className="qosp-panel-help">{describeWorkbookIssue(locale, issue)}</p>
                  </li>
                ))}
              </ul>
              {issues.length > MAX_ISSUES_SHOWN ? (
                <p className="qosp-meta-line">
                  {staffCopyWith(locale, "importIssuesMore", { count: issues.length - MAX_ISSUES_SHOWN })}
                </p>
              ) : null}
            </>
          ) : null}
        </PortalPanel>
      ) : null}
    </div>
  );
}
