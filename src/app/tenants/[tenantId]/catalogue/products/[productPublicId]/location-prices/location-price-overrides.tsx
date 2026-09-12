"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type LocationPriceView = {
  locationPublicId: string;
  locationName: string;
  currency: string;
  amountMinor: number;
  inheritanceMode: "inherited" | "override";
  centralPriceVersion: number;
  overrideAmountMinor: number | null;
  canResetToCentral: boolean;
};

type LocationPriceBundle = {
  productPublicId: string;
  variantPublicId: string;
  centralAmountMinor: number;
  centralPriceVersion: number;
  currency: string;
  canEditPrice: boolean;
  locations: LocationPriceView[];
};

type LocationPriceOverridesProps = {
  tenantId: string;
  productPublicId: string;
};

function minorToMajor(value: number) {
  return (value / 100).toFixed(2);
}

function majorToMinor(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

export function LocationPriceOverrides({
  tenantId,
  productPublicId,
}: LocationPriceOverridesProps) {
  const [bundle, setBundle] = useState<LocationPriceBundle | null>(null);
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyLocationPublicId, setBusyLocationPublicId] = useState<string | null>(
    null,
  );

  const loadPrices = useCallback(async () => {
    setError(null);

    const response = await staffApiFetch(
      `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/location-prices`,
    );

    const payload = (await response.json()) as {
      locationPrices?: LocationPriceBundle;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load location prices.");
    }

    const nextBundle = payload.locationPrices ?? null;
    setBundle(nextBundle);

    if (nextBundle) {
      setDraftAmounts(
        Object.fromEntries(
          nextBundle.locations.map((location) => [
            location.locationPublicId,
            minorToMajor(location.overrideAmountMinor ?? location.amountMinor),
          ]),
        ),
      );
    }
  }, [productPublicId, tenantId]);

  async function saveOverride(locationPublicId: string) {
    const amountMinor = majorToMinor(draftAmounts[locationPublicId] ?? "");
    if (amountMinor == null) {
      setError("Enter a valid price.");
      return;
    }

    setBusyLocationPublicId(locationPublicId);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/locations/${locationPublicId}/price`,
        {
          method: "PUT",
          body: JSON.stringify({ amountMinor }),
        },
      );

      const payload = (await response.json()) as {
        locationPrices?: LocationPriceBundle;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save location override.");
      }

      const nextBundle = payload.locationPrices ?? null;
      setBundle(nextBundle);

      if (nextBundle) {
        setDraftAmounts(
          Object.fromEntries(
            nextBundle.locations.map((location) => [
              location.locationPublicId,
              minorToMajor(location.overrideAmountMinor ?? location.amountMinor),
            ]),
          ),
        );
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to save location override.",
      );
    } finally {
      setBusyLocationPublicId(null);
    }
  }

  async function resetOverride(locationPublicId: string) {
    setBusyLocationPublicId(locationPublicId);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/locations/${locationPublicId}/price/reset`,
        {
          method: "POST",
        },
      );

      const payload = (await response.json()) as {
        locationPrices?: LocationPriceBundle;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reset location override.");
      }

      const nextBundle = payload.locationPrices ?? null;
      setBundle(nextBundle);

      if (nextBundle) {
        setDraftAmounts(
          Object.fromEntries(
            nextBundle.locations.map((location) => [
              location.locationPublicId,
              minorToMajor(location.amountMinor),
            ]),
          ),
        );
      }
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to reset location override.",
      );
    } finally {
      setBusyLocationPublicId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm text-zinc-600">
          Sign in at{" "}
          <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
            staff sign-in
          </Link>{" "}
          before loading or editing location prices.
        </p>
        <button
          type="button"
          onClick={() => {
            void loadPrices().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load location prices.",
              );
            });
          }}
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Load location prices
        </button>
      </section>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {bundle ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-500">Central draft price</p>
              <p className="text-lg font-medium">
                {minorToMajor(bundle.centralAmountMinor)} {bundle.currency} (v
                {bundle.centralPriceVersion})
              </p>
            </div>
            <Link
              href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/edit`}
              className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
            >
              Back to product editor
            </Link>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">Location</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Inheritance</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    Effective price
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Override</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {bundle.locations.map((location) => (
                  <tr key={location.locationPublicId}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{location.locationName}</div>
                      <div className="text-zinc-500">{location.locationPublicId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          location.inheritanceMode === "override"
                            ? "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
                            : "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800"
                        }
                      >
                        {location.inheritanceMode === "override"
                          ? "Override"
                          : "Inherited"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {minorToMajor(location.amountMinor)} {location.currency}
                    </td>
                    <td className="px-4 py-3">
                      {bundle.canEditPrice ? (
                        <input
                          className="w-28 rounded-lg border border-zinc-300 px-2 py-1"
                          value={draftAmounts[location.locationPublicId] ?? ""}
                          onChange={(event) =>
                            setDraftAmounts((current) => ({
                              ...current,
                              [location.locationPublicId]: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {bundle.canEditPrice ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyLocationPublicId === location.locationPublicId}
                            onClick={() => void saveOverride(location.locationPublicId)}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Save override
                          </button>
                          {location.canResetToCentral ? (
                            <button
                              type="button"
                              disabled={
                                busyLocationPublicId === location.locationPublicId
                              }
                              onClick={() =>
                                void resetOverride(location.locationPublicId)
                              }
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-50"
                            >
                              Reset to central
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        "View only"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
