"use client";

import { usePortalShell } from "@/components/portal/portal-shell-context";
import {
  PortalArea,
  PortalBadge,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { branchStatusLabel, businessBranchLabel } from "@/lib/staff/branch-copy";
import { staffUiCopy } from "@/lib/staff/locale";

/* Settings > Branches (QOS-192), read only. The requested business branch
   names are listed as not yet mapped, beside the locations this membership
   may actually work in. Both come from the server's branch context; nothing
   here writes, renames or links anything. */
export function BranchesSettingsScreen() {
  const { branch } = usePortalShell();
  const { locale } = useStaffLocale();
  const t = (key: Parameters<typeof staffUiCopy>[1]) => staffUiCopy(locale, key);

  return (
    <PortalArea>
      <PortalPageHeader
        title={t("branches")}
        description={t("branchesSettingsDescription")}
      />

      {branch.status === "error" ? (
        <PortalNotice tone="error">{t("branchesLoadError")}</PortalNotice>
      ) : branch.status !== "ready" ? (
        <PortalPanel>
          <p className="qosp-meta-line" role="status">
            {t("branchLoading")}
          </p>
        </PortalPanel>
      ) : (
        <div className="qosp-stack">
          <PortalPanel>
            <h2 className="qosp-panel-title">{t("requestedBranchesTitle")}</h2>
            <p className="qosp-panel-help">{t("requestedBranchesBody")}</p>
            <ul className="qosp-branch-list qosp-panel-body" aria-label={t("requestedBranchesTitle")}>
              {branch.requestedBusinessLabels.map((label) => (
                <li key={label.key} className="qosp-branch-row qosp-subcard" data-columns="3">
                  <div className="qosp-branch-row-main">
                    <span className="qosp-branch-row-label">{t("columnBusinessBranch")}</span>
                    <strong className="qosp-branch-row-name">
                      {businessBranchLabel(locale, label.key)}
                    </strong>
                  </div>
                  <div className="qosp-branch-row-main">
                    <span className="qosp-branch-row-label">{t("columnQosLocation")}</span>
                    <span>{t("noLocationConfirmed")}</span>
                  </div>
                  <div className="qosp-branch-row-status">
                    <span className="qosp-branch-row-label">{t("columnMapping")}</span>
                    <PortalBadge tone="warm">{t("notYetMapped")}</PortalBadge>
                  </div>
                </li>
              ))}
            </ul>
            <div className="qosp-panel-body">
              <PortalNotice tone="info">{t("mappingPendingNote")}</PortalNotice>
            </div>
          </PortalPanel>

          <PortalPanel>
            <h2 className="qosp-panel-title">{t("permittedLocationsTitle")}</h2>
            <p className="qosp-panel-help">
              {t(
                branch.role === "administrator"
                  ? "permittedLocationsAdminBody"
                  : "permittedLocationsUserBody",
              )}{" "}
              {t("baseCurrencyNote")}
            </p>
            {branch.branches.length === 0 ? (
              <div className="qosp-panel-body">
                <PortalNotice tone="warning">{t("noBranchesBody")}</PortalNotice>
              </div>
            ) : (
              <ul className="qosp-branch-list qosp-panel-body" aria-label={t("permittedLocationsTitle")}>
                {branch.branches.map((entry) => (
                  <li key={entry.publicId} className="qosp-branch-row qosp-subcard">
                    <div className="qosp-branch-row-main">
                      <span className="qosp-branch-row-label">{t("columnLocation")}</span>
                      <strong className="qosp-branch-row-name">{entry.name}</strong>
                      <code className="qosp-code" dir="ltr">
                        {entry.publicId}
                      </code>
                    </div>
                    <div className="qosp-branch-row-main">
                      <span className="qosp-branch-row-label">{t("columnTimezone")}</span>
                      <span dir="ltr">{entry.timezone}</span>
                    </div>
                    <div className="qosp-branch-row-main">
                      <span className="qosp-branch-row-label">{t("columnCurrency")}</span>
                      <span dir="ltr">{entry.currency}</span>
                    </div>
                    <div className="qosp-branch-row-status">
                      <span className="qosp-branch-row-label">{t("columnStatus")}</span>
                      <PortalBadge tone={entry.status === "active" ? "positive" : "danger"}>
                        {branchStatusLabel(locale, entry.status)}
                      </PortalBadge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PortalPanel>
        </div>
      )}
    </PortalArea>
  );
}
