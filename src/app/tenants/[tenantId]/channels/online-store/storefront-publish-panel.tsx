"use client";

import { useCallback, useState } from "react";
import { History, Rocket, Undo2 } from "lucide-react";

import {
  releaseOutcomeMessage,
  type StorefrontSummary,
} from "@/app/tenants/[tenantId]/channels/online-store/storefront-view";
import {
  formatStorefrontDateTime,
  storefrontsCopy,
  type StorefrontsCopyKey,
} from "@/app/tenants/[tenantId]/channels/online-store/storefronts-copy";
import { PortalBadge, PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

type ReleaseRow = {
  publicId: string;
  releaseVersion: number;
  publishedBySubject: string;
  createdAt: string | Date;
  isActive: boolean;
};

type StorefrontPublishPanelProps = {
  tenantId: string;
  storefront: StorefrontSummary;
  isAdministrator: boolean;
  onStorefrontUpdated: () => Promise<void>;
};

export function StorefrontPublishPanel({
  tenantId,
  storefront,
  isAdministrator,
  onStorefrontUpdated,
}: StorefrontPublishPanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: StorefrontsCopyKey, values?: Record<string, string | number>) =>
    storefrontsCopy(locale, key, values);
  const [releases, setReleases] = useState<ReleaseRow[] | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ReleaseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<
    Array<{ field: string; message: string }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"history" | "publish" | "rollback" | null>(null);

  const loadReleases = useCallback(async () => {
    setBusy("history");
    setError(null);
    setValidationIssues([]);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefront.publicId}/releases`,
      );
      const payload = (await response.json()) as {
        releases?: ReleaseRow[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToLoadHistory"));
      }

      setReleases(
        [...(payload.releases ?? [])].sort(
          (left, right) => right.releaseVersion - left.releaseVersion,
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : storefrontsCopy(locale, "unableToLoadHistory"),
      );
    } finally {
      setBusy(null);
    }
  }, [locale, storefront.publicId, tenantId]);

  const publishDraft = useCallback(async () => {
    if (!isAdministrator) {
      setError(storefrontsCopy(locale, "adminRequiredPublish"));
      return;
    }

    setBusy("publish");
    setError(null);
    setValidationIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefront.publicId}/publish`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const payload = (await response.json()) as {
        publish?: {
          releasePublicId: string;
          releaseVersion: number;
          idempotentReplay: boolean;
        };
        error?: string;
        issues?: Array<{ field: string; message: string }>;
      };

      if (!response.ok) {
        setValidationIssues(payload.issues ?? []);
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToPublish"));
      }

      const publish = payload.publish;
      if (!publish) {
        throw new Error(storefrontsCopy(locale, "publishIncomplete"));
      }

      setMessage(releaseOutcomeMessage(locale, "publish", publish));

      await loadReleases();
      await onStorefrontUpdated();
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : storefrontsCopy(locale, "unableToPublish"),
      );
    } finally {
      setBusy(null);
    }
  }, [
    isAdministrator,
    loadReleases,
    locale,
    onStorefrontUpdated,
    storefront.publicId,
    tenantId,
  ]);

  const rollbackRelease = useCallback(async () => {
    if (!rollbackTarget) {
      return;
    }

    if (!isAdministrator) {
      setError(storefrontsCopy(locale, "adminRequiredRollback"));
      return;
    }

    setBusy("rollback");
    setError(null);
    setValidationIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefront.publicId}/rollback`,
        {
          method: "POST",
          body: JSON.stringify({
            releasePublicId: rollbackTarget.publicId,
          }),
        },
      );
      const payload = (await response.json()) as {
        rollback?: {
          releasePublicId: string;
          releaseVersion: number;
          idempotentReplay: boolean;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToRollback"));
      }

      const rollback = payload.rollback;
      if (!rollback) {
        throw new Error(storefrontsCopy(locale, "rollbackIncomplete"));
      }

      setMessage(releaseOutcomeMessage(locale, "rollback", rollback));
      setRollbackTarget(null);

      await loadReleases();
      await onStorefrontUpdated();
    } catch (rollbackError) {
      setError(
        rollbackError instanceof Error
          ? rollbackError.message
          : storefrontsCopy(locale, "unableToRollback"),
      );
    } finally {
      setBusy(null);
    }
  }, [
    isAdministrator,
    loadReleases,
    locale,
    onStorefrontUpdated,
    rollbackTarget,
    storefront.publicId,
    tenantId,
  ]);

  const rollbackTitleId = `storefront-rollback-${storefront.publicId}`;

  return (
    <section
      className="qosp-glass qosp-sf-section qosp-sf-releases"
      aria-labelledby={`storefront-releases-${storefront.publicId}`}
    >
      <div className="qosp-sf-head">
        <div className="qosp-sf-head-text">
          <h2 id={`storefront-releases-${storefront.publicId}`} className="qosp-panel-title">
            {copy("releasesTitle")}
          </h2>
          <p className="qosp-panel-help">{copy("releasesHelp")}</p>
        </div>
      </div>

      {storefront.activeRelease ? (
        <div className="qosp-sf-live">
          <PortalBadge tone="positive">{copy("statusLive")}</PortalBadge>
          <div className="qosp-sf-live-text">
            <p className="qosp-subcard-title">
              {copy("liveReleaseTitle", { version: storefront.activeRelease.releaseVersion })}
            </p>
            <p className="qosp-meta-line">
              {copy("liveReleasePublished", {
                date: formatStorefrontDateTime(locale, storefront.activeRelease.publishedAt),
              })}
            </p>
            <p className="qosp-meta-line">
              {copy("historyBy")}{" "}
              <bdi dir="ltr">{storefront.activeRelease.publishedBySubject}</bdi>
            </p>
          </div>
        </div>
      ) : (
        <PortalNotice tone="warning">{copy("noLiveRelease")}</PortalNotice>
      )}

      <div className="qosp-button-row">
        <button
          type="button"
          disabled={busy !== null || !isAdministrator}
          onClick={() => void publishDraft()}
          className="qos-btn"
          data-variant="primary"
        >
          <Rocket size={16} aria-hidden="true" />
          {busy === "publish" ? copy("publishing") : copy("publishDraft")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void loadReleases()}
          className="qos-btn"
          data-variant="secondary"
        >
          <History size={16} aria-hidden="true" />
          {busy === "history" ? copy("loadingHistory") : copy("loadHistory")}
        </button>
      </div>

      {!isAdministrator ? (
        <PortalNotice tone="info">{copy("nonAdminPublishNotice")}</PortalNotice>
      ) : null}

      {validationIssues.length > 0 ? (
        <div className="qosp-notice" data-tone="error" role="alert">
          <div>
            <p className="qosp-sf-notice-title">{copy("publishBlocked")}</p>
            <ul className="qosp-sf-issues">
              {validationIssues.map((issue) => (
                <li key={`${issue.field}:${issue.message}`}>
                  {copy("issueLine", { field: issue.field, message: issue.message })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {message ? <PortalNotice tone="success">{message}</PortalNotice> : null}

      {releases ? (
        <div className="qosp-sf-history">
          <h3 className="qosp-subcard-title">{copy("historyTitle")}</h3>
          {releases.length === 0 ? (
            <p className="qosp-meta-line">{copy("historyEmpty")}</p>
          ) : (
            <ul className="qosp-sf-release-list">
              {releases.map((release) => (
                <li key={release.publicId} className="qosp-sf-release">
                  <div className="qosp-sf-release-main">
                    <div className="qosp-sf-release-head">
                      <span className="qosp-sf-release-version">
                        {copy("versionValue", { version: release.releaseVersion })}
                      </span>
                      <PortalBadge tone={release.isActive ? "positive" : "neutral"}>
                        {release.isActive ? copy("releaseLive") : copy("releaseArchived")}
                      </PortalBadge>
                    </div>
                    <dl className="qosp-sf-release-meta">
                      <div>
                        <dt>{copy("historyPublished")}</dt>
                        <dd>{formatStorefrontDateTime(locale, release.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>{copy("historyBy")}</dt>
                        <dd dir="ltr">{release.publishedBySubject}</dd>
                      </div>
                    </dl>
                    <span className="qosp-code" dir="ltr">
                      {release.publicId}
                    </span>
                  </div>
                  {!release.isActive && isAdministrator ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setRollbackTarget(release)}
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      aria-label={copy("rollBackTo", { version: release.releaseVersion })}
                    >
                      <Undo2 size={14} aria-hidden="true" />
                      {copy("rollBack")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {rollbackTarget ? (
        <div
          className="qosp-subcard qosp-sf-confirm"
          role="group"
          aria-labelledby={rollbackTitleId}
        >
          <p id={rollbackTitleId} className="qosp-subcard-title">
            {copy("rollbackConfirmTitle", { version: rollbackTarget.releaseVersion })}
          </p>
          <p className="qosp-panel-help">
            {copy("rollbackConfirmBody", {
              host: storefront.primaryHostname ?? copy("thisStorefront"),
            })}
          </p>
          <div className="qosp-button-row">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void rollbackRelease()}
              className="qos-btn"
              data-variant="primary"
            >
              {busy === "rollback" ? copy("rollingBack") : copy("confirmRollback")}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setRollbackTarget(null)}
              className="qos-btn"
              data-variant="secondary"
            >
              {staffUiCopy(locale, "cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
