"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ProductModifierGroupsPanelProps = {
  tenantId: string;
  productPublicId: string;
};

type AvailableGroup = {
  publicId: string;
  internalName: string;
  translations: { en: { displayName: string } };
};

type AssignedGroup = {
  modifierGroupPublicId: string;
  sortOrder: number;
  translations: { en: { displayName: string } };
  options: Array<{ publicId: string; priceMinor: number }>;
};

type ProductModifierView = {
  productVersion: number;
  modifierGroups: AssignedGroup[];
};

export function ProductModifierGroupsPanel({
  tenantId,
  productPublicId,
}: ProductModifierGroupsPanelProps) {
  const [view, setView] = useState<ProductModifierView | null>(null);
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([]);
  const [selectedGroupPublicId, setSelectedGroupPublicId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const [productResponse, groupsResponse] = await Promise.all([
        staffApiFetch(
          `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups`,
        ),
        staffApiFetch(`/api/tenants/${tenantId}/catalogue/modifier-groups`),
      ]);

      const productPayload = (await productResponse.json()) as ProductModifierView & {
        error?: string;
      };
      const groupsPayload = (await groupsResponse.json()) as {
        groups?: AvailableGroup[];
        error?: string;
      };

      if (!productResponse.ok) {
        throw new Error(productPayload.error ?? "Unable to load product modifiers.");
      }

      if (!groupsResponse.ok) {
        throw new Error(groupsPayload.error ?? "Unable to load modifier groups.");
      }

      setView(productPayload);
      setAvailableGroups(groupsPayload.groups ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load modifier assignments.",
      );
    } finally {
      setBusy(false);
    }
  }, [productPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function attachGroup() {
    if (!view || !selectedGroupPublicId) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            modifierGroupPublicId: selectedGroupPublicId,
          }),
        },
      );
      const payload = (await response.json()) as ProductModifierView & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to attach modifier group.");
      }

      setView(payload);
      setSelectedGroupPublicId("");
      setMessage("Modifier group attached.");
    } catch (attachError) {
      setError(
        attachError instanceof Error
          ? attachError.message
          : "Unable to attach modifier group.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function detachGroup(groupPublicId: string) {
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/modifier-groups/${groupPublicId}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
          }),
        },
      );
      const payload = (await response.json()) as ProductModifierView & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to detach modifier group.");
      }

      setView(payload);
      setMessage("Modifier group detached.");
    } catch (detachError) {
      setError(
        detachError instanceof Error
          ? detachError.message
          : "Unable to detach modifier group.",
      );
    } finally {
      setBusy(false);
    }
  }

  const unattachedGroups = availableGroups.filter(
    (group) =>
      !view?.modifierGroups.some(
        (assigned) => assigned.modifierGroupPublicId === group.publicId,
      ),
  );

  return (
    <section className="mt-10 border-t border-zinc-200 pt-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Modifier groups</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Attach reusable choice groups to this product.
          </p>
        </div>
        <Link
          href={`/tenants/${tenantId}/catalogue/modifier-groups`}
          className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
        >
          Manage groups
        </Link>
      </div>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <div className="space-y-3">
        {(view?.modifierGroups ?? []).map((group) => (
          <article
            key={group.modifierGroupPublicId}
            className="qos-card" data-padding="sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium">
                  {group.translations.en.displayName || group.modifierGroupPublicId}
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  {group.modifierGroupPublicId} · {group.options.length} option(s)
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void detachGroup(group.modifierGroupPublicId)}
                className="qos-btn" data-variant="danger" data-size="sm"
              >
                Detach
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Attach group</span>
          <select
            className="qos-select"
            value={selectedGroupPublicId}
            disabled={busy || unattachedGroups.length === 0}
            onChange={(event) => setSelectedGroupPublicId(event.target.value)}
          >
            <option value="">Select a modifier group</option>
            {unattachedGroups.map((group) => (
              <option key={group.publicId} value={group.publicId}>
                {group.translations.en.displayName || group.internalName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !selectedGroupPublicId || !view}
          onClick={() => void attachGroup()}
          className="qos-btn" data-variant="primary"
        >
          Attach
        </button>
      </div>
    </section>
  );
}
