"use client";

import { useCallback, useMemo, useState } from "react";

type TranslationFormState = {
  displayName: string;
  description: string;
  translationVersion: number;
};

type ProductEditorState = {
  publicId: string | null;
  internalName: string;
  sku: string;
  barcode: string;
  version: number;
  businessProfile: "hospitality" | "generic_retail";
  canEditPrice: boolean;
  nutritionCalories: string;
  priceMajor: string;
  translations: {
    en: TranslationFormState;
    ar: TranslationFormState;
  };
};

type ProductEditorProps = {
  tenantId: string;
  productPublicId?: string;
  initialBusinessProfile?: "hospitality" | "generic_retail";
};

const emptyTranslation = (): TranslationFormState => ({
  displayName: "",
  description: "",
  translationVersion: 1,
});

const initialState: ProductEditorState = {
  publicId: null,
  internalName: "",
  sku: "",
  barcode: "",
  version: 1,
  businessProfile: "generic_retail",
  canEditPrice: true,
  nutritionCalories: "",
  priceMajor: "",
  translations: {
    en: emptyTranslation(),
    ar: emptyTranslation(),
  },
};

function majorToMinor(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function minorToMajor(value: number) {
  return (value / 100).toFixed(2);
}

function createEmptyFormState(
  businessProfile: "hospitality" | "generic_retail",
): ProductEditorState {
  return {
    ...initialState,
    businessProfile,
  };
}

export function ProductEditor({
  tenantId,
  productPublicId,
  initialBusinessProfile = "generic_retail",
}: ProductEditorProps) {
  const isEditMode = Boolean(productPublicId);
  const [staffSubject, setStaffSubject] = useState("admin@quotes.test");
  const [staffEmail, setStaffEmail] = useState("admin@quotes.test");
  const [form, setForm] = useState<ProductEditorState>(() =>
    createEmptyFormState(initialBusinessProfile),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(createEmptyFormState(initialBusinessProfile)),
  );
  const [loading, setLoading] = useState(false);
  const [hasLoadedProduct, setHasLoadedProduct] = useState(!isEditMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const serializedForm = useMemo(() => JSON.stringify(form), [form]);
  const isDirty = baseline !== "" && serializedForm !== baseline;

  const staffHeaders = useMemo(
    () => ({
      "X-QOS-Staff-Subject": staffSubject,
      "X-QOS-Staff-Email": staffEmail,
      "Content-Type": "application/json",
    }),
    [staffEmail, staffSubject],
  );

  const applyProductPayload = useCallback(
    (product: {
      publicId: string;
      internalName: string;
      version: number;
      sku: string | null;
      barcode: string | null;
      nutritionCalories: number | null;
      businessProfile: "hospitality" | "generic_retail";
      canEditPrice: boolean;
      defaultVariant: { amountMinor: number };
      translations: {
        en: TranslationFormState & { approvalStatus?: string };
        ar: TranslationFormState & { approvalStatus?: string };
      };
    }) => {
      const nextState: ProductEditorState = {
        publicId: product.publicId,
        internalName: product.internalName,
        sku: product.sku ?? "",
        barcode: product.barcode ?? "",
        version: product.version,
        businessProfile: product.businessProfile,
        canEditPrice: product.canEditPrice,
        nutritionCalories:
          product.nutritionCalories == null
            ? ""
            : String(product.nutritionCalories),
        priceMajor: minorToMajor(product.defaultVariant.amountMinor),
        translations: {
          en: {
            displayName: product.translations.en.displayName,
            description: product.translations.en.description ?? "",
            translationVersion: product.translations.en.translationVersion,
          },
          ar: {
            displayName: product.translations.ar.displayName,
            description: product.translations.ar.description ?? "",
            translationVersion: product.translations.ar.translationVersion,
          },
        },
      };

      setForm(nextState);
      setBaseline(JSON.stringify(nextState));
      setHasLoadedProduct(true);
    },
    [],
  );

  const loadProduct = useCallback(async () => {
    if (!productPublicId) {
      return;
    }

    setLoading(true);
    setError(null);
    setFieldError(null);

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`,
        { headers: staffHeaders },
      );
      const payload = (await response.json()) as {
        product?: Parameters<typeof applyProductPayload>[0];
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load product.");
      }

      if (!payload.product) {
        throw new Error("Product payload is missing.");
      }

      applyProductPayload(payload.product);
    } finally {
      setLoading(false);
    }
  }, [applyProductPayload, productPublicId, staffHeaders, tenantId]);

  function resetForm() {
    if (!isDirty) {
      return;
    }

    const confirmed = window.confirm(
      "Discard unsaved changes to this draft product?",
    );
    if (!confirmed) {
      return;
    }

    setForm(JSON.parse(baseline) as ProductEditorState);
    setError(null);
    setFieldError(null);
    setSavedMessage(null);
  }

  async function saveProduct() {
    setSaving(true);
    setError(null);
    setFieldError(null);
    setSavedMessage(null);

    const amountMinor = majorToMinor(form.priceMajor);
    if (amountMinor == null) {
      setFieldError("defaultVariant.amountMinor");
      setError("Enter a valid AED price.");
      setSaving(false);
      return;
    }

    try {
      if (isEditMode && productPublicId) {
        const response = await fetch(
          `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`,
          {
            method: "PATCH",
            headers: staffHeaders,
            body: JSON.stringify({
              expectedVersion: form.version,
              internalName: form.internalName,
              sku: form.sku || null,
              barcode: form.barcode || null,
              nutritionCalories:
                form.businessProfile === "hospitality" && form.nutritionCalories
                  ? Number.parseInt(form.nutritionCalories, 10)
                  : null,
              translations: {
                en: {
                  displayName: form.translations.en.displayName,
                  description: form.translations.en.description || null,
                  expectedTranslationVersion:
                    form.translations.en.translationVersion,
                },
                ar: {
                  displayName: form.translations.ar.displayName,
                  description: form.translations.ar.description || null,
                  expectedTranslationVersion:
                    form.translations.ar.translationVersion,
                },
              },
              defaultVariant: form.canEditPrice
                ? { amountMinor }
                : undefined,
            }),
          },
        );

        const payload = (await response.json()) as {
          product?: Parameters<typeof applyProductPayload>[0];
          error?: string;
          field?: string;
        };

        if (!response.ok) {
          setFieldError(payload.field ?? null);
          throw new Error(payload.error ?? "Unable to save product.");
        }

        if (!payload.product) {
          throw new Error("Saved product payload is missing.");
        }

        applyProductPayload(payload.product);
        setSavedMessage("Draft product saved.");
        return;
      }

      const response = await fetch(
        `/api/tenants/${tenantId}/catalogue/products`,
        {
          method: "POST",
          headers: staffHeaders,
          body: JSON.stringify({
            internalName: form.internalName,
            sku: form.sku || null,
            barcode: form.barcode || null,
            nutritionCalories:
              form.businessProfile === "hospitality" && form.nutritionCalories
                ? Number.parseInt(form.nutritionCalories, 10)
                : null,
            translations: {
              en: {
                displayName: form.translations.en.displayName,
                description: form.translations.en.description || null,
              },
              ar: {
                displayName: form.translations.ar.displayName,
                description: form.translations.ar.description || null,
              },
            },
            defaultVariant: {
              amountMinor,
              currency: "AED",
            },
          }),
        },
      );

      const payload = (await response.json()) as {
        product?: Parameters<typeof applyProductPayload>[0];
        error?: string;
        field?: string;
      };

      if (!response.ok) {
        setFieldError(payload.field ?? null);
        throw new Error(payload.error ?? "Unable to create product.");
      }

      if (!payload.product) {
        throw new Error("Created product payload is missing.");
      }

      applyProductPayload(payload.product);
      setSavedMessage(`Draft product ${payload.product.publicId} created.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save product.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (isEditMode && !hasLoadedProduct && !loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">
          Load the draft product to begin editing.
        </p>
        <button
          type="button"
          onClick={() =>
            void loadProduct().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load product.",
              );
            })
          }
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          Load product
        </button>
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-zinc-600">Loading product…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">
            Staff subject
          </span>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={staffSubject}
            onChange={(event) => setStaffSubject(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Staff email</span>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={staffEmail}
            onChange={(event) => setStaffEmail(event.target.value)}
          />
        </label>
      </div>

      {isEditMode ? (
        <button
          type="button"
          onClick={() =>
            void loadProduct().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to reload product.",
              );
            })
          }
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          Reload product
        </button>
      ) : null}

      <section className="rounded-xl border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">General information</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Internal name
            </span>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={form.internalName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  internalName: event.target.value,
                }))
              }
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-700">SKU</span>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={form.sku}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sku: event.target.value }))
                }
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-700">Barcode</span>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={form.barcode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    barcode: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">English copy</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Display name
            </span>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={form.translations.en.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    en: {
                      ...current.translations.en,
                      displayName: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Description
            </span>
            <textarea
              className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={form.translations.en.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    en: {
                      ...current.translations.en,
                      description: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <p className="text-xs text-zinc-500">
            Translation version: {form.translations.en.translationVersion}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Arabic copy</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Display name
            </span>
            <input
              dir="rtl"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={form.translations.ar.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    ar: {
                      ...current.translations.ar,
                      displayName: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Description
            </span>
            <textarea
              dir="rtl"
              className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2"
              value={form.translations.ar.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  translations: {
                    ...current.translations,
                    ar: {
                      ...current.translations.ar,
                      description: event.target.value,
                    },
                  },
                }))
              }
            />
          </label>
          <p className="text-xs text-zinc-500">
            Translation version: {form.translations.ar.translationVersion}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Default variant price (AED)
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              disabled={!form.canEditPrice}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 disabled:bg-zinc-100"
              value={form.priceMajor}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priceMajor: event.target.value,
                }))
              }
            />
            {!form.canEditPrice ? (
              <span className="text-xs text-zinc-500">
                Price changes require an administrator.
              </span>
            ) : null}
          </label>
          {form.businessProfile === "hospitality" ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-zinc-700">
                Calories (optional)
              </span>
              <input
                type="number"
                min="0"
                step="1"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                value={form.nutritionCalories}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    nutritionCalories: event.target.value,
                  }))
                }
              />
            </label>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          {fieldError ? ` (${fieldError})` : ""}
        </p>
      ) : null}

      {savedMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {savedMessage}
        </p>
      ) : null}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
        <p className="text-sm text-zinc-600">
          {isDirty ? "Unsaved changes" : "All changes saved locally"}
          {form.publicId ? (
            <>
              {" "}
              · Product <code>{form.publicId}</code> · Version {form.version}
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetForm}
            disabled={!isDirty || saving}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveProduct()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
