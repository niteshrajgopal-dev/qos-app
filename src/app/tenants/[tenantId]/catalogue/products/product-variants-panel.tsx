"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type VariantTranslation = {
  displayName: string;
};

type VariantRow = {
  publicId: string;
  isDefault: boolean;
  sortOrder: number;
  status: "active" | "archived";
  sku: string;
  barcode: string;
  amountMinor: number | null;
  translations: {
    en: VariantTranslation;
    ar: VariantTranslation;
  };
};

type VariantsResponse = {
  productPublicId: string;
  productVersion: number;
  canEditPrice: boolean;
  variants: VariantRow[];
};

type ProductVariantsPanelProps = {
  tenantId: string;
  productPublicId: string;
};

type NewVariantForm = {
  enLabel: string;
  arLabel: string;
  priceMajor: string;
  sku: string;
  barcode: string;
  publicId: string;
};

const emptyNewVariant = (): NewVariantForm => ({
  enLabel: "",
  arLabel: "",
  priceMajor: "",
  sku: "",
  barcode: "",
  publicId: "",
});

function majorToMinor(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function minorToMajor(value: number | null) {
  if (value == null) {
    return "";
  }

  return (value / 100).toFixed(2);
}

export function ProductVariantsPanel({
  tenantId,
  productPublicId,
}: ProductVariantsPanelProps) {
  const [view, setView] = useState<VariantsResponse | null>(null);
  const [newVariant, setNewVariant] = useState<NewVariantForm>(emptyNewVariant);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeVariants = useMemo(
    () => view?.variants.filter((variant) => variant.status === "active") ?? [],
    [view],
  );

  const loadVariants = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants`,
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load variants.");
      }

      setView(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load variants.",
      );
    } finally {
      setBusy(false);
    }
  }, [productPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadVariants();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadVariants]);

  async function saveVariant(
    variantPublicId: string,
    patch: Record<string, unknown>,
  ) {
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants/${variantPublicId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            ...patch,
          }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.field
            ? `${payload.error ?? "Unable to save variant."} (${payload.field})`
            : payload.error ?? "Unable to save variant.",
        );
      }

      setView(payload);
      setMessage("Variant saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save variant.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateVariant(event: React.FormEvent) {
    event.preventDefault();
    if (!view) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const amountMinor = newVariant.priceMajor.trim()
      ? majorToMinor(newVariant.priceMajor)
      : null;

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            publicId: newVariant.publicId.trim() || undefined,
            translations: {
              en: { displayName: newVariant.enLabel.trim() },
              ar: { displayName: newVariant.arLabel.trim() },
            },
            sku: newVariant.sku.trim() || null,
            barcode: newVariant.barcode.trim() || null,
            amountMinor,
          }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.field
            ? `${payload.error ?? "Unable to create variant."} (${payload.field})`
            : payload.error ?? "Unable to create variant.",
        );
      }

      setView(payload);
      setNewVariant(emptyNewVariant());
      setMessage("Variant added.");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create variant.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleReorder(variantPublicId: string, direction: "up" | "down") {
    if (!view) {
      return;
    }

    const ordered = activeVariants.map((variant) => variant.publicId);
    const index = ordered.indexOf(variantPublicId);
    if (index < 0) {
      return;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) {
      return;
    }

    [ordered[index], ordered[targetIndex]] = [
      ordered[targetIndex],
      ordered[index],
    ];

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/variants/reorder`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedProductVersion: view.productVersion,
            orderedPublicIds: ordered,
          }),
        },
      );
      const payload = (await response.json()) as VariantsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reorder variants.");
      }

      setView(payload);
      setMessage("Variant order updated.");
    } catch (reorderError) {
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : "Unable to reorder variants.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 border-t border-zinc-200 pt-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Sellable variants</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Maintain size or style choices under one product. Archived variants
            stay referenced by history but are not offered for new purchases.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadVariants()}
          disabled={busy}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Reload
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <div className="space-y-4">
        {(view?.variants ?? []).map((variant) => (
          <article
            key={variant.publicId}
            className={`rounded-xl border p-4 ${
              variant.status === "archived"
                ? "border-zinc-200 bg-zinc-50 opacity-80"
                : "border-zinc-200 bg-white"
            }`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs">
                {variant.publicId}
              </code>
              {variant.isDefault ? (
                <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
                  Default
                </span>
              ) : null}
              {variant.status === "archived" ? (
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  Archived
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">English label</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={variant.translations.en.displayName}
                  disabled={variant.status === "archived" || busy}
                  onChange={(event) => {
                    if (!view) {
                      return;
                    }

                    setView({
                      ...view,
                      variants: view.variants.map((entry) =>
                        entry.publicId === variant.publicId
                          ? {
                              ...entry,
                              translations: {
                                ...entry.translations,
                                en: { displayName: event.target.value },
                              },
                            }
                          : entry,
                      ),
                    });
                  }}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">Arabic label</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={variant.translations.ar.displayName}
                  disabled={variant.status === "archived" || busy}
                  onChange={(event) => {
                    if (!view) {
                      return;
                    }

                    setView({
                      ...view,
                      variants: view.variants.map((entry) =>
                        entry.publicId === variant.publicId
                          ? {
                              ...entry,
                              translations: {
                                ...entry.translations,
                                ar: { displayName: event.target.value },
                              },
                            }
                          : entry,
                      ),
                    });
                  }}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">AED price</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={minorToMajor(variant.amountMinor)}
                  disabled={
                    variant.status === "archived" || busy || !view?.canEditPrice
                  }
                  onChange={(event) => {
                    if (!view) {
                      return;
                    }

                    const amountMinor = majorToMinor(event.target.value);
                    setView({
                      ...view,
                      variants: view.variants.map((entry) =>
                        entry.publicId === variant.publicId
                          ? { ...entry, amountMinor }
                          : entry,
                      ),
                    });
                  }}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">SKU</span>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
                  value={variant.sku ?? ""}
                  disabled={variant.status === "archived" || busy}
                  onChange={(event) => {
                    if (!view) {
                      return;
                    }

                    setView({
                      ...view,
                      variants: view.variants.map((entry) =>
                        entry.publicId === variant.publicId
                          ? { ...entry, sku: event.target.value }
                          : entry,
                      ),
                    });
                  }}
                />
              </label>
            </div>

            {variant.status === "active" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void saveVariant(variant.publicId, {
                      translations: variant.translations,
                      sku: variant.sku.trim() || null,
                      barcode: variant.barcode.trim() || null,
                      amountMinor: variant.amountMinor,
                    })
                  }
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  Save variant
                </button>
                {!variant.isDefault ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void saveVariant(variant.publicId, { isDefault: true })
                    }
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Make default
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReorder(variant.publicId, "up")}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReorder(variant.publicId, "down")}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Move down
                </button>
                {!variant.isDefault ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void saveVariant(variant.publicId, { status: "archived" })
                    }
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <form
        onSubmit={(event) => void handleCreateVariant(event)}
        className="mt-8 rounded-xl border border-dashed border-zinc-300 p-4"
      >
        <h3 className="text-lg font-medium">Add variant</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">English label</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={newVariant.enLabel}
              disabled={busy}
              onChange={(event) =>
                setNewVariant({ ...newVariant, enLabel: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Arabic label</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={newVariant.arLabel}
              disabled={busy}
              onChange={(event) =>
                setNewVariant({ ...newVariant, arLabel: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">AED price</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={newVariant.priceMajor}
              disabled={busy || view?.canEditPrice === false}
              onChange={(event) =>
                setNewVariant({ ...newVariant, priceMajor: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Optional public ID</span>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
              placeholder="var_medium_abc12345"
              value={newVariant.publicId}
              disabled={busy}
              onChange={(event) =>
                setNewVariant({ ...newVariant, publicId: event.target.value })
              }
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || !view}
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          Add variant
        </button>
      </form>
    </section>
  );
}
