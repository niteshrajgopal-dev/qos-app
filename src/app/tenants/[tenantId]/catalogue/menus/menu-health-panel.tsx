"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  MENU_HEALTH_ISSUE_COPY,
  SEVERITY_BADGE_TONE,
  menuHealthHeadline,
  productFixHref,
  productsForIssueType,
  visibleIssueGroups,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-view";
import { MenuManagerSection } from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-section";
import { unavailableHint } from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-view";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
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
};

export function MenuHealthPanel({
  tenantId,
  menuPublicId,
  menuVersion,
}: MenuHealthPanelProps) {
  const [report, setReport] = useState<MenuHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusType, setFocusType] = useState<MenuHealthIssueType | null>(null);
  const [agents, setAgents] = useState<TenantAgentSettingsView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

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
    ? unavailableHint(agents.menuManager.unavailableReason, agents.canManage)
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
        throw new Error(payload.error ?? "Unable to check menu health.");
      }

      setReport(payload.health);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to check menu health.",
      );
    } finally {
      setLoading(false);
    }
  }, [menuPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHealth();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHealth, menuVersion]);

  const groups = report ? visibleIssueGroups(report) : [];
  const drawerGroups = focusType
    ? groups.filter((group) => group.type === focusType)
    : groups;

  function openDrawer(type: MenuHealthIssueType | null) {
    setFocusType(type);
    setDrawerOpen(true);
  }

  return (
    <>
    <Card
      header="Menu health"
      subtitle={
        report
          ? `Checked against saved draft v${report.menuVersion} · ${new Date(report.evaluatedAt).toLocaleTimeString()}`
          : "Deterministic QOS checks of the saved draft"
      }
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          loading={loading}
          onClick={() => void loadHealth()}
        >
          Re-check
        </Button>
      }
    >
      {error ? (
        <Alert tone="error" title="Menu health unavailable">
          {error}
        </Alert>
      ) : null}

      {!report && !error ? (
        <p className="qos-card-sub">Checking menu health…</p>
      ) : null}

      {report ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <strong style={{ fontSize: 28, lineHeight: "32px" }}>
              {report.completeness.percent === null
                ? "—"
                : `${report.completeness.percent}%`}
            </strong>
            <span className="qos-card-sub">
              {groups.length > 0
                ? `complete · ${report.completeness.passedChecks} of ${report.completeness.totalChecks} checks passed`
                : `complete · ${menuHealthHeadline(report)}`}
            </span>
          </div>

          {groups.length > 0 ? (
            <Alert
              tone="warning"
              title={menuHealthHeadline(report)}
              actions={
                <Button size="sm" variant="secondary" onClick={() => openDrawer(null)}>
                  Review issues
                </Button>
              }
            >
              Fixes are made in the product editor; nothing here changes the
              menu automatically.
            </Alert>
          ) : null}

          {groups.length > 0 ? (
            <div
              aria-label="Menu health issues"
              style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
            >
              {groups.map((group) => (
                <button
                  key={group.type}
                  type="button"
                  className="qos-btn"
                  data-variant="secondary"
                  data-size="sm"
                  onClick={() => openDrawer(group.type)}
                >
                  {MENU_HEALTH_ISSUE_COPY[group.type].title}
                  <Badge tone={SEVERITY_BADGE_TONE[group.severity]}>
                    {group.productCount}
                  </Badge>
                </button>
              ))}
            </div>
          ) : null}

          {report.availability.closedLocations.length > 0 ? (
            <p className="qos-card-sub">
              Stop-sale status not checked for{" "}
              {report.availability.closedLocations
                .map((location) => location.name)
                .join(", ")}{" "}
              because {report.availability.closedLocations.length === 1 ? "it is" : "they are"}{" "}
              closed right now.
            </p>
          ) : null}
        </div>
      ) : null}

      <Drawer
        open={drawerOpen && Boolean(report)}
        width={520}
        title={
          focusType ? MENU_HEALTH_ISSUE_COPY[focusType].title : "Menu health issues"
        }
        description={report ? menuHealthHeadline(report) : undefined}
        onClose={() => setDrawerOpen(false)}
        footer={
          (focusType && groups.length > 1) || (menuManagerAvailable && selected.length > 0) ? (
            <>
              {menuManagerAvailable && selected.length > 0 ? (
                <span className="qos-card-sub">
                  {selected.length} selected for Menu Manager
                </span>
              ) : null}
              {focusType && groups.length > 1 ? (
                <Button variant="secondary" onClick={() => setFocusType(null)}>
                  Show all issues
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
                  <strong>{MENU_HEALTH_ISSUE_COPY[group.type].title}</strong>
                  <Badge tone={SEVERITY_BADGE_TONE[group.severity]}>
                    {group.productCount}
                  </Badge>
                </div>
                <p className="qos-card-sub">
                  {MENU_HEALTH_ISSUE_COPY[group.type].description}
                </p>
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
                              Select {product.displayName} for Menu Manager
                            </span>
                          }
                          checked={selected.includes(product.productPublicId)}
                          onChange={() => toggleSelected(product.productPublicId)}
                        />
                      ) : null}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div>{product.displayName}</div>
                        <div className="qos-card-sub">
                          <code>{product.productPublicId}</code>
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
                        {MENU_HEALTH_ISSUE_COPY[group.type].fixLabel}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </Drawer>
      {agentHint ? <p className="qos-card-sub">{agentHint}</p> : null}
    </Card>
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
