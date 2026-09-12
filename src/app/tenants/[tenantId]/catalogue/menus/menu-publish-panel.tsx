"use client";

import { useCallback, useMemo, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type LocationOption = {
  id: string;
  name: string;
};

type PublishPreviewTarget = {
  locationId: string;
  locationPublicId: string;
  locationName: string;
  currentSourceVersion: number | null;
  willChange: boolean;
  products: Array<{
    productPublicId: string;
    displayName: string;
    price: {
      amountMinor: number;
      currency: string;
      inheritanceMode: "inherited" | "override";
    };
  }>;
};

type MenuPublishPanelProps = {
  tenantId: string;
  menuPublicId: string;
  menuVersion: number;
  assignedLocationIds: string[];
  locations: LocationOption[];
};

function minorToMajor(value: number) {
  return (value / 100).toFixed(2);
}

export function MenuPublishPanel({
  tenantId,
  menuPublicId,
  menuVersion,
  assignedLocationIds,
  locations,
}: MenuPublishPanelProps) {
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [previewTargets, setPreviewTargets] = useState<PublishPreviewTarget[]>(
    [],
  );
  const [operationId, setOperationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assignedLocations = useMemo(
    () => locations.filter((location) => assignedLocationIds.includes(location.id)),
    [assignedLocationIds, locations],
  );

  const toggleLocation = useCallback((locationId: string) => {
    setSelectedLocationIds((current) =>
      current.includes(locationId)
        ? current.filter((value) => value !== locationId)
        : [...current, locationId],
    );
  }, []);

  const loadPreview = useCallback(async () => {
    if (selectedLocationIds.length === 0) {
      setError("Select at least one publish target location.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const params = new URLSearchParams();
      for (const locationId of selectedLocationIds) {
        params.append("locationId", locationId);
      }

      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/publish-preview?${params.toString()}`,
      );
      const payload = (await response.json()) as {
        preview?: { targets: PublishPreviewTarget[] };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load publish preview.");
      }

      setPreviewTargets(payload.preview?.targets ?? []);
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Unable to load publish preview.",
      );
    } finally {
      setBusy(false);
    }
  }, [menuPublicId, selectedLocationIds, tenantId]);

  const publishMenu = useCallback(async () => {
    if (selectedLocationIds.length === 0) {
      setError("Select at least one publish target location.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            locationIds: selectedLocationIds,
            operationId: operationId.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json()) as {
        publish?: {
          operationId: string;
          status: string;
          results: Array<{
            locationPublicId: string;
            success: boolean;
            error?: string;
          }>;
        };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to publish menu.");
      }

      const publish = payload.publish;
      if (!publish) {
        throw new Error("Publish response was incomplete.");
      }

      setOperationId(publish.operationId);

      const summary = publish.results
        .map((result) =>
          result.success
            ? `${result.locationPublicId}: published`
            : `${result.locationPublicId}: ${result.error ?? "failed"}`,
        )
        .join(" · ");

      setMessage(`Publish ${publish.status}. ${summary}`);
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish menu.",
      );
    } finally {
      setBusy(false);
    }
  }, [menuPublicId, operationId, selectedLocationIds, tenantId]);

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-5">
      <div>
        <h2 className="text-lg font-semibold">Publish draft</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Select one or more authorized locations explicitly. Unselected
          locations keep their current live release unchanged.
        </p>
      </div>

      <div className="space-y-2">
        {assignedLocations.map((location) => (
          <label
            key={location.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={selectedLocationIds.includes(location.id)}
              onChange={() => toggleLocation(location.id)}
            />
            <span>{location.name}</span>
          </label>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Operation id (retry)</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={operationId}
            onChange={(event) => setOperationId(event.target.value)}
            placeholder="Optional idempotency key"
          />
        </label>
        <div className="flex items-end text-sm text-zinc-600">
          Draft version {menuVersion}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadPreview()}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          Preview selected targets
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void publishMenu()}
          className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Publish to selected locations
        </button>
      </div>

      {previewTargets.length > 0 ? (
        <div className="space-y-3">
          {previewTargets.map((target) => (
            <article
              key={target.locationId}
              className="rounded-lg border border-zinc-200 bg-white p-4 text-sm"
            >
              <p className="font-medium">
                {target.locationName}{" "}
                <span className="text-zinc-500">({target.locationPublicId})</span>
              </p>
              <p className="mt-1 text-zinc-600">
                Current live v{target.currentSourceVersion ?? "none"} ·{" "}
                {target.willChange ? "Will update" : "Already at draft version"}
              </p>
              <ul className="mt-2 space-y-1 text-zinc-700">
                {target.products.map((product) => (
                  <li key={product.productPublicId}>
                    {product.displayName}: {minorToMajor(product.price.amountMinor)}{" "}
                    {product.price.currency} ({product.price.inheritanceMode})
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
    </section>
  );
}
