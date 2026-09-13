"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ModifierGroupSummary = {
  publicId: string;
  internalName: string;
  minSelections: number;
  maxSelections: number;
  version: number;
  optionCount: number;
  affectedProductCount: number;
  translations: {
    en: { displayName: string };
    ar: { displayName: string };
  };
};

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default function ModifierGroupsPage({ params }: PageProps) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ModifierGroupSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ tenantId: resolvedTenantId }) => {
      setTenantId(resolvedTenantId);
    });
  }, [params]);

  const loadGroups = useCallback(async () => {
    if (!tenantId) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/modifier-groups`,
      );
      const payload = (await response.json()) as {
        groups?: ModifierGroupSummary[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load modifier groups.");
      }

      setGroups(payload.groups ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load modifier groups.",
      );
    } finally {
      setBusy(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadGroups();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadGroups, tenantId]);

  async function createGroup() {
    if (!tenantId) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/modifier-groups`,
        {
          method: "POST",
          body: JSON.stringify({
            internalName: "new-modifier-group",
            translations: {
              en: { displayName: "New Modifier Group" },
              ar: { displayName: "مجموعة جديدة" },
            },
          }),
        },
      );
      const payload = (await response.json()) as {
        group?: { publicId: string };
        error?: string;
      };

      if (!response.ok || !payload.group) {
        throw new Error(payload.error ?? "Unable to create modifier group.");
      }

      window.location.href = `/tenants/${tenantId}/catalogue/modifier-groups/${payload.group.publicId}/edit`;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create modifier group.",
      );
      setBusy(false);
    }
  }

  if (!tenantId) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div className="qos-pagehead">
        <div>
          <h1 className="qos-pagetitle">Modifier groups</h1>
          <p className="qos-pagesub">
            Reusable choice groups such as milk type or gift wrapping.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void createGroup()}
          className="qos-btn"
          data-variant="primary"
        >
          New group
        </button>
      </div>

      {error ? (
        <div className="qos-alert" data-tone="error" role="alert">
          <div className="qos-alert-body">{error}</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {groups.map((group) => (
          <Link
            key={group.publicId}
            href={`/tenants/${tenantId}/catalogue/modifier-groups/${group.publicId}/edit`}
            className="qos-card"
            data-padding="sm"
            data-interactive="true"
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <strong>
                  {group.translations.en.displayName || group.internalName}
                </strong>
                <p className="qos-card-sub">
                  {group.publicId} · min {group.minSelections} / max{" "}
                  {group.maxSelections} · {group.optionCount} option(s) ·{" "}
                  {group.affectedProductCount} product(s)
                </p>
              </div>
              <span className="qos-card-sub">v{group.version}</span>
            </div>
          </Link>
        ))}
        {!busy && groups.length === 0 ? (
          <p className="qos-pagesub">No modifier groups yet.</p>
        ) : null}
      </div>
    </div>
  );
}
