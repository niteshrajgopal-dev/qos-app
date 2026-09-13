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
    <div className="min-h-screen bg-zinc-50 px-6 py-10 font-sans text-zinc-900">
      <main className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Catalogue
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Modifier groups</h1>
            <p className="mt-2 text-zinc-600">
              Reusable choice groups such as milk type or gift wrapping.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createGroup()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            New group
          </button>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="space-y-3">
          {groups.map((group) => (
            <Link
              key={group.publicId}
              href={`/tenants/${tenantId}/catalogue/modifier-groups/${group.publicId}/edit`}
              className="block rounded-xl border border-zinc-200 p-4 hover:bg-zinc-50"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium">
                    {group.translations.en.displayName || group.internalName}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {group.publicId} · min {group.minSelections} / max{" "}
                    {group.maxSelections} · {group.optionCount} option(s) ·{" "}
                    {group.affectedProductCount} product(s)
                  </p>
                </div>
                <span className="text-sm text-zinc-500">v{group.version}</span>
              </div>
            </Link>
          ))}
          {!busy && groups.length === 0 ? (
            <p className="text-sm text-zinc-600">No modifier groups yet.</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
