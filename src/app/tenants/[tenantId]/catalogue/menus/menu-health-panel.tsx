"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  SEVERITY_BADGE_TONE,
  menuHealthHeadline,
  menuHealthIssueCopy,
  productFixHref,
  productsForIssueType,
  visibleIssueGroups,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-view";
import { menuPhotoSummary } from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-view";
import { MenuManagerSection } from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-section";
import { unavailableHint } from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-view";
import {
  formatMenuTime,
  menusCopy,
  menusCount,
  type MenusCopyKey,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Drawer } from "@/components/Drawer";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { ProgressBar } from "@/design-system/components/data/ProgressBar";
import { Checkbox } from "@/design-system/components/primitives/Checkbox";
import type { TenantAgentSettingsView } from "@/lib/agents/tenant-agent-settings";
import type {
  MenuHealthIssueType,
  MenuHealthReport,
} from "@/lib/catalogue/menu-health";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type MenuHealthPanelProps = {
  tenantId: string;
  menuPublicId: string;
  /** Saved draft version; health is re-checked whenever it changes. */
  menuVersion: number;
  /** Bumped by the parent after photo changes so counts re-check. */
  refreshKey?: number;
  onReport?: (report: MenuHealthReport) => void;
};

export function MenuHealthPanel({
  tenantId,
  menuPublicId,
  menuVersion,
  refreshKey = 0,
  onReport,
}: MenuHealthPanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: MenusCopyKey, values?: Record<string, string | number>) =>
    menusCopy(locale, key, values);
  const issueCopy = (type: MenuHealthIssueType) => menuHealthIssueCopy(type, locale);
  const [report, setReport] = useState<MenuHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusType, setFocusType] = useState<MenuHealthIssueType | null>(null);
  const [agents, setAgents] = useState<TenantAgentSettingsView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const onReportRef = useRef(onReport);
  useEffect(() => {
    onReportRef.current = onReport;
  }, [onReport]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await staffApiFetch(`/api/tenants/${tenantId}/agents`);
        const payload = (await response.json().catch(() => ({}))) as {
          agents?: TenantAgentSettingsView;
        };
        if (!cancelled && response.ok && payload.agents) {
          setAgents(payload.agents);
        }
      } catch {
        // Without agent settings the AI entry point simply stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const menuManagerAvailable = agents?.menuManager.available ?? false;
  const agentHint = agents
    ? unavailableHint(agents.menuManager.unavailableReason, agents.canManage, locale)
    : null;

  function toggleSelected(productPublicId: string) {
    setSelected((current) =>
      current.includes(productPublicId)
        ? current.filter((id) => id !== productPublicId)
        : [...current, productPublicId],
    );
  }

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/health`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        health?: MenuHealthReport;
        error?: string;
      };

      if (!response.ok || !payload.health) {
        throw new Error(payload.error ?? menusCopy(locale, "healthUnableToCheck"));
      }

      setReport(payload.health);
      onReportRef.current?.(payload.health);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : menusCopy(locale, "healthUnableToCheck"),
      );
    } finally {
      setLoading(false);
    }
  }, [locale, menuPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHealth();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHealth, menuVersion, refreshKey]);

  const groups = report ? visibleIssueGroups(report) : [];
  const photos = report ? menuPhotoSummary(report) : null;
  const drawerGroups = focusType
    ? groups.filter((group) => group.type === focusType)
    : groups;

  function openDrawer(type: MenuHealthIssueType | null) {
    setFocusType(type);
    setDrawerOpen(true);
  }

  return (
    <>
      <section className="qosp-editor-section qosp-glass" aria-labelledby="menu-health-title">
        <div className="qosp-section-head">
          <div>
            <h2 id="menu-health-title" className="qosp-panel-title">
              {copy("healthTitle")}
            </h2>
            <p className="qosp-panel-help">
              {report
                ? copy("healthCheckedAgainst", {
                    version: report.menuVersion,
                    time: formatMenuTime(locale, report.evaluatedAt),
                  })
                : copy("healthDeterministic")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon="refresh-cw"
            loading={loading}
            onClick={() => void loadHealth()}
          >
            {copy("healthRecheck")}
          </Button>
        </div>

        <div className="qosp-panel-body qosp-stack">
          {error ? (
            <Alert tone="error" title={copy("healthUnavailable")}>
              {error}
            </Alert>
          ) : null}

          {!report && !error ? (
            <p className="qosp-meta-line" role="status">
              {copy("healthChecking")}
            </p>
          ) : null}

          {report && photos ? (
            <>
              <div className="qos-menu-summary">
                <div className="qos-menu-summary-head">
                  <span className="qosp-meta-line">
                    {groups.length > 0
                      ? menusCount(locale, "checksPassed", report.completeness.totalChecks, {
                          passed: report.completeness.passedChecks,
                        })
                      : menuHealthHeadline(report, locale)}
                  </span>
                  <span className="qos-menu-summary-pct" dir="ltr">
                    {report.completeness.percent === null ? "—" : `${report.completeness.percent}%`}
                  </span>
                </div>
                <ProgressBar tone="intelligence" value={report.completeness.percent ?? 0} />
                {photos.totalItems > 0 ? (
                  <div className="qos-legend" aria-label={copy("healthPhotoCoverage")}>
                    <span className="qos-legend-item">
                      <span className="qos-legend-dot" aria-hidden="true" />
                      {menusCount(locale, "itemsWithPhotos", photos.withPhotos)}
                    </span>
                    <span className="qos-legend-item">
                      <span className="qos-legend-dot" data-tone="intelligence" aria-hidden="true" />
                      {menusCount(locale, "itemsNeedPhotos", photos.needPhotos)}
                    </span>
                  </div>
                ) : null}
              </div>

              {groups.length > 0 ? (
                <Alert
                  tone="warning"
                  title={menuHealthHeadline(report, locale)}
                  actions={
                    <Button size="sm" variant="secondary" onClick={() => openDrawer(null)}>
                      {copy("healthReviewIssues")}
                    </Button>
                  }
                >
                  {copy("healthFixesNote")}
                </Alert>
              ) : null}

              {groups.length > 0 ? (
                <div aria-label={copy("healthIssuesLabel")} className="qosp-button-row">
                  {groups.map((group) => (
                    <button
                      key={group.type}
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      onClick={() => openDrawer(group.type)}
                    >
                      {issueCopy(group.type).title}
                      <Badge tone={SEVERITY_BADGE_TONE[group.severity]}>
                        {group.productCount}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : null}

              {report.availability.closedLocations.length > 0 ? (
                <p className="qosp-meta-line">
                  {menusCount(locale, "stopSaleNotChecked", report.availability.closedLocations.length, {
                    names: report.availability.closedLocations
                      .map((location) => location.name)
                      .join(locale === "ar" ? "، " : ", "),
                  })}
                </p>
              ) : null}
            </>
          ) : null}

          {agentHint ? <p className="qosp-meta-line">{agentHint}</p> : null}
        </div>

        <Drawer
          open={drawerOpen && Boolean(report)}
          width={520}
          title={focusType ? issueCopy(focusType).title : copy("healthIssuesLabel")}
          description={report ? menuHealthHeadline(report, locale) : undefined}
          onClose={() => setDrawerOpen(false)}
          footer={
            (focusType && groups.length > 1) || (menuManagerAvailable && selected.length > 0) ? (
              <>
                {menuManagerAvailable && selected.length > 0 ? (
                  <span className="qos-card-sub">
                    {menusCount(locale, "selectedForManager", selected.length)}
                  </span>
                ) : null}
                {focusType && groups.length > 1 ? (
                  <Button variant="secondary" onClick={() => setFocusType(null)}>
                    {copy("healthShowAllIssues")}
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        >
          {report ? (
            <div style={{ display: "grid", gap: 20 }}>
              {drawerGroups.map((group) => (
                <section key={group.type} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{issueCopy(group.type).title}</strong>
                    <Badge tone={SEVERITY_BADGE_TONE[group.severity]}>
                      {group.productCount}
                    </Badge>
                  </div>
                  <p className="qos-card-sub">{issueCopy(group.type).description}</p>
                  <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
                    {productsForIssueType(report, group.type).map((product) => (
                      <li
                        key={product.productPublicId}
                        className="qos-card"
                        data-padding="sm"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        {menuManagerAvailable ? (
                          <Checkbox
                            label={
                              <span className="sr-only">
                                {copy("healthSelectForManager", { name: product.displayName })}
                              </span>
                            }
                            checked={selected.includes(product.productPublicId)}
                            onChange={() => toggleSelected(product.productPublicId)}
                          />
                        ) : null}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div>{product.displayName}</div>
                          <div className="qos-card-sub">
                            <code dir="ltr">{product.productPublicId}</code>
                          </div>
                          {product.messages.map((message) => (
                            <div key={message} className="qos-card-sub">
                              {message}
                            </div>
                          ))}
                        </div>
                        <Link
                          href={productFixHref(tenantId, product.productPublicId, group.type)}
                          className="qos-btn"
                          data-variant="ghost"
                          data-size="sm"
                        >
                          {issueCopy(group.type).fixLabel}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}
        </Drawer>
      </section>
      {menuManagerAvailable ? (
        <MenuManagerSection
          tenantId={tenantId}
          menuPublicId={menuPublicId}
          menuVersion={menuVersion}
          report={report}
          selectedProductPublicIds={selected}
          onClearSelection={() => setSelected([])}
        />
      ) : null}
    </>
  );
}
