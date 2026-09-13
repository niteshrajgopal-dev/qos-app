"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { ButtonLink } from "@/components/ButtonLink";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type MenuSummary = {
  publicId: string;
  internalName: string;
  displayName: string;
  status: "draft" | "active" | "archived";
  version: number;
  isLive: boolean;
  hasUnpublishedChanges: boolean;
  sectionCount: number;
  itemCount: number;
  updatedAt: string;
};

type MenuManagementProps = {
  tenantId: string;
};

export function MenuManagement({ tenantId }: MenuManagementProps) {
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadMenus = useCallback(async () => {
    const response = await staffApiFetch(
      `/api/tenants/${tenantId}/catalogue/menus`,
    );
    const payload = (await response.json()) as {
      menus?: MenuSummary[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load menus.");
    }

    setError(null);
    setMenus(payload.menus ?? []);
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMenus().catch((loadError) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load menus.",
        );
        setLoaded(true);
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadMenus]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          onClick={() =>
            void loadMenus().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load menus.",
              );
            })
          }
        >
          Reload
        </Button>
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/menus/new`}
          variant="primary"
        >
          New menu
        </ButtonLink>
      </div>

      {error ? (
        <Alert tone="error" title="Unable to load menus">
          {error}
        </Alert>
      ) : null}

      {loaded && menus.length === 0 ? (
        <EmptyState
          icon="book-open"
          title="No menus yet"
          body="Create a draft menu, add items, then publish it to a Quotes location."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {menus.map((menu) => (
            <Card key={menu.publicId} padding="sm">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>{menu.displayName}</strong>
                  <p className="qos-card-sub">
                    {menu.internalName} · {menu.itemCount} items · v{menu.version}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <StatusBadge state={menu.isLive ? "live" : menu.status} />
                  <ButtonLink
                    href={`/tenants/${tenantId}/catalogue/menus/${menu.publicId}/edit`}
                    variant="secondary"
                    size="sm"
                  >
                    Edit
                  </ButtonLink>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
