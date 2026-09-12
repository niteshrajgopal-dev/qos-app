"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { MenuPublishPanel } from "@/app/tenants/[tenantId]/catalogue/menus/menu-publish-panel";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type TranslationState = {
  displayName: string;
  description: string;
};

type SectionProductState = {
  productPublicId: string;
  displayName: string;
  sortOrder: number;
  archived: boolean;
};

type SectionState = {
  publicId?: string;
  internalName: string;
  sortOrder: number;
  archived: boolean;
  collapsed: boolean;
  translations: {
    en: TranslationState;
    ar: TranslationState;
  };
  products: SectionProductState[];
};

type MenuEditorState = {
  publicId: string | null;
  internalName: string;
  version: number;
  locationIds: string[];
  translations: {
    en: TranslationState;
    ar: TranslationState;
  };
  sections: SectionState[];
};

type ProductOption = {
  publicId: string;
  displayName: string;
};

type LocationOption = {
  id: string;
  name: string;
};

type MenuEditorProps = {
  tenantId: string;
  menuPublicId?: string;
};

function emptySection(sortOrder: number): SectionState {
  return {
    internalName: "",
    sortOrder,
    archived: false,
    collapsed: false,
    translations: {
      en: { displayName: "", description: "" },
      ar: { displayName: "", description: "" },
    },
    products: [],
  };
}

function createInitialState(): MenuEditorState {
  return {
    publicId: null,
    internalName: "",
    version: 1,
    locationIds: [],
    translations: {
      en: { displayName: "", description: "" },
      ar: { displayName: "", description: "" },
    },
    sections: [emptySection(0)],
  };
}

function normalizeSections(sections: SectionState[]) {
  return sections.map((section, index) => ({
    ...section,
    sortOrder: index,
    products: section.products.map((product, productIndex) => ({
      ...product,
      sortOrder: productIndex,
    })),
  }));
}

export function MenuEditor({ tenantId, menuPublicId }: MenuEditorProps) {
  const isEditMode = Boolean(menuPublicId);
  const [form, setForm] = useState<MenuEditorState>(createInitialState);
  const [baseline, setBaseline] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(!isEditMode);

  const serializedForm = useMemo(() => JSON.stringify(form), [form]);
  const isDirty = baseline !== "" && serializedForm !== baseline;

  const applyMenuPayload = useCallback(
    (menu: {
      publicId: string;
      internalName: string;
      version: number;
      locationIds: string[];
      translations: {
        en: TranslationState & { translationVersion?: number };
        ar: TranslationState & { translationVersion?: number };
      };
      sections: Array<{
        publicId: string;
        internalName: string;
        sortOrder: number;
        archived: boolean;
        translations: {
          en: TranslationState;
          ar: TranslationState;
        };
        products: Array<{
          productPublicId: string;
          displayName: string;
          sortOrder: number;
          archived: boolean;
        }>;
      }>;
    }) => {
      const nextState: MenuEditorState = {
        publicId: menu.publicId,
        internalName: menu.internalName,
        version: menu.version,
        locationIds: menu.locationIds,
        translations: {
          en: {
            displayName: menu.translations.en.displayName,
            description: menu.translations.en.description ?? "",
          },
          ar: {
            displayName: menu.translations.ar.displayName,
            description: menu.translations.ar.description ?? "",
          },
        },
        sections: menu.sections.map((section) => ({
          publicId: section.publicId,
          internalName: section.internalName,
          sortOrder: section.sortOrder,
          archived: section.archived,
          collapsed: false,
          translations: {
            en: {
              displayName: section.translations.en.displayName,
              description: section.translations.en.description ?? "",
            },
            ar: {
              displayName: section.translations.ar.displayName,
              description: section.translations.ar.description ?? "",
            },
          },
          products: section.products.map((product) => ({
            productPublicId: product.productPublicId,
            displayName: product.displayName,
            sortOrder: product.sortOrder,
            archived: product.archived,
          })),
        })),
      };

      setForm(nextState);
      setBaseline(JSON.stringify(nextState));
      setHasLoaded(true);
    },
    [],
  );

  const loadSupportData = useCallback(async () => {
    const [productsResponse, locationsResponse] = await Promise.all([
      staffApiFetch(`/api/tenants/${tenantId}/catalogue/products`),
      staffApiFetch(`/api/tenants/${tenantId}/staff/locations`),
    ]);

    const productsPayload = (await productsResponse.json()) as {
      products?: ProductOption[];
      error?: string;
    };
    const locationsPayload = (await locationsResponse.json()) as {
      locations?: LocationOption[];
      error?: string;
    };

    if (!productsResponse.ok) {
      throw new Error(productsPayload.error ?? "Unable to load products.");
    }

    if (!locationsResponse.ok) {
      throw new Error(locationsPayload.error ?? "Unable to load locations.");
    }

    setProducts(productsPayload.products ?? []);
    setLocations(locationsPayload.locations ?? []);
  }, [tenantId]);

  const loadMenu = useCallback(async () => {
    if (!menuPublicId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await loadSupportData();
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}`,
        {},
      );
      const payload = (await response.json()) as {
        menu?: Parameters<typeof applyMenuPayload>[0];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load menu.");
      }

      if (!payload.menu) {
        throw new Error("Menu payload is missing.");
      }

      applyMenuPayload(payload.menu);
    } finally {
      setLoading(false);
    }
  }, [applyMenuPayload, loadSupportData, menuPublicId, tenantId]);

  async function prepareNewMenu() {
    setLoading(true);
    setError(null);

    try {
      await loadSupportData();
      const initial = createInitialState();
      setForm(initial);
      setBaseline(JSON.stringify(initial));
      setHasLoaded(true);
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Unable to prepare menu editor.",
      );
    } finally {
      setLoading(false);
    }
  }

  function moveSection(index: number, direction: -1 | 1) {
    setForm((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.sections.length) {
        return current;
      }

      const sections = [...current.sections];
      const [moved] = sections.splice(index, 1);
      sections.splice(targetIndex, 0, moved);

      return { ...current, sections: normalizeSections(sections) };
    });
  }

  function moveProduct(sectionIndex: number, productIndex: number, direction: -1 | 1) {
    setForm((current) => {
      const sections = [...current.sections];
      const section = sections[sectionIndex];
      if (!section) {
        return current;
      }

      const targetIndex = productIndex + direction;
      if (targetIndex < 0 || targetIndex >= section.products.length) {
        return current;
      }

      const productsForSection = [...section.products];
      const [moved] = productsForSection.splice(productIndex, 1);
      productsForSection.splice(targetIndex, 0, moved);

      sections[sectionIndex] = {
        ...section,
        products: productsForSection.map((product, index) => ({
          ...product,
          sortOrder: index,
        })),
      };

      return { ...current, sections };
    });
  }

  function resetForm() {
    if (!isDirty) {
      return;
    }

    const confirmed = window.confirm(
      "Discard unsaved changes to this draft menu?",
    );
    if (!confirmed) {
      return;
    }

    setForm(JSON.parse(baseline) as MenuEditorState);
    setError(null);
    setSavedMessage(null);
  }

  async function saveMenu() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);

    const sectionsPayload = normalizeSections(form.sections).map((section) => ({
      publicId: section.publicId,
      internalName: section.internalName,
      sortOrder: section.sortOrder,
      archived: section.archived,
      translations: section.translations,
      products: section.products.map((product) => ({
        productPublicId: product.productPublicId,
        sortOrder: product.sortOrder,
        archived: product.archived,
      })),
    }));

    try {
      if (isEditMode && menuPublicId) {
        const response = await staffApiFetch(
          `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion: form.version,
              internalName: form.internalName,
              locationIds: form.locationIds,
              translations: form.translations,
              sections: sectionsPayload,
            }),
          },
        );

        const payload = (await response.json()) as {
          menu?: Parameters<typeof applyMenuPayload>[0];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to save menu.");
        }

        if (!payload.menu) {
          throw new Error("Saved menu payload is missing.");
        }

        applyMenuPayload(payload.menu);
        setSavedMessage("Draft menu saved.");
        return;
      }

      const response = await staffApiFetch(`/api/tenants/${tenantId}/catalogue/menus`, {
        method: "POST",
        body: JSON.stringify({
          internalName: form.internalName,
          locationIds: form.locationIds,
          translations: form.translations,
          sections: sectionsPayload,
        }),
      });

      const payload = (await response.json()) as {
        menu?: Parameters<typeof applyMenuPayload>[0];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create menu.");
      }

      if (!payload.menu) {
        throw new Error("Created menu payload is missing.");
      }

      applyMenuPayload(payload.menu);
      setSavedMessage(`Draft menu ${payload.menu.publicId} created.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save menu.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!hasLoaded && !loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">
          {isEditMode
            ? "Load the draft menu to begin editing."
            : "Prepare the menu editor to begin."}
        </p>
        <button
          type="button"
          onClick={() =>
            void (isEditMode ? loadMenu() : prepareNewMenu()).catch(
              (loadError) => {
                setError(
                  loadError instanceof Error
                    ? loadError.message
                    : "Unable to load menu editor.",
                );
              },
            )
          }
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
        >
          {isEditMode ? "Load menu" : "Start new menu"}
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
    return <p className="text-sm text-zinc-600">Loading menu…</p>;
  }

  return (
    <div className="space-y-6 pb-24">
      <p className="text-sm text-zinc-600">
        Sign in at{" "}
        <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
          staff sign-in
        </Link>{" "}
        before saving or publishing menus.
      </p>

      <section className="rounded-xl border border-zinc-200 p-5">
        <h2 className="text-lg font-semibold">Menu details</h2>
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
              <span className="text-sm font-medium text-zinc-700">
                English menu name
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
                Arabic menu name
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
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-700">Locations</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {locations.map((location) => {
                const checked = form.locationIds.includes(location.id);
                return (
                  <label key={location.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setForm((current) => ({
                          ...current,
                          locationIds: checked
                            ? current.locationIds.filter((id) => id !== location.id)
                            : [...current.locationIds, location.id],
                        }))
                      }
                    />
                    {location.name}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Sections</h2>
          <button
            type="button"
            onClick={() =>
              setForm((current) => ({
                ...current,
                sections: normalizeSections([
                  ...current.sections,
                  emptySection(current.sections.length),
                ]),
              }))
            }
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
          >
            Add section
          </button>
        </div>

        {form.sections.map((section, sectionIndex) => (
          <article
            key={section.publicId ?? `new-${sectionIndex}`}
            className="rounded-xl border border-zinc-200 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    sections: current.sections.map((item, index) =>
                      index === sectionIndex
                        ? { ...item, collapsed: !item.collapsed }
                        : item,
                    ),
                  }))
                }
                className="text-left"
              >
                <p className="font-medium text-zinc-900">
                  {section.translations.en.displayName || section.internalName || "Untitled section"}
                </p>
                <p className="text-sm text-zinc-600">
                  {section.products.length} items
                </p>
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moveSection(sectionIndex, -1)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm"
                >
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(sectionIndex, 1)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm"
                >
                  Move down
                </button>
              </div>
            </div>

            {!section.collapsed ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Internal section name
                    </span>
                    <input
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                      value={section.internalName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          sections: current.sections.map((item, index) =>
                            index === sectionIndex
                              ? { ...item, internalName: event.target.value }
                              : item,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-zinc-700">
                      English section label
                    </span>
                    <input
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                      value={section.translations.en.displayName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          sections: current.sections.map((item, index) =>
                            index === sectionIndex
                              ? {
                                  ...item,
                                  translations: {
                                    ...item.translations,
                                    en: {
                                      ...item.translations.en,
                                      displayName: event.target.value,
                                    },
                                  },
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label className="block space-y-2 md:col-span-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Arabic section label
                    </span>
                    <input
                      dir="rtl"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2"
                      value={section.translations.ar.displayName}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          sections: current.sections.map((item, index) =>
                            index === sectionIndex
                              ? {
                                  ...item,
                                  translations: {
                                    ...item.translations,
                                    ar: {
                                      ...item.translations.ar,
                                      displayName: event.target.value,
                                    },
                                  },
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  {section.products.map((product, productIndex) => (
                    <div
                      key={`${product.productPublicId}-${productIndex}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{product.displayName}</p>
                        <p className="text-xs text-zinc-500">{product.productPublicId}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => moveProduct(sectionIndex, productIndex, -1)}
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveProduct(sectionIndex, productIndex, 1)}
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs"
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              sections: current.sections.map((item, index) =>
                                index === sectionIndex
                                  ? {
                                      ...item,
                                      products: item.products.filter(
                                        (_, idx) => idx !== productIndex,
                                      ),
                                    }
                                  : item,
                              ),
                            }))
                          }
                          className="rounded-full border border-zinc-300 px-3 py-1 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Add product
                    </span>
                    <select
                      className="rounded-lg border border-zinc-300 px-3 py-2"
                      defaultValue=""
                      onChange={(event) => {
                        const selected = products.find(
                          (product) => product.publicId === event.target.value,
                        );
                        if (!selected) {
                          return;
                        }

                        setForm((current) => ({
                          ...current,
                          sections: current.sections.map((item, index) =>
                            index === sectionIndex
                              ? {
                                  ...item,
                                  products: [
                                    ...item.products,
                                    {
                                      productPublicId: selected.publicId,
                                      displayName: selected.displayName,
                                      sortOrder: item.products.length,
                                      archived: false,
                                    },
                                  ],
                                }
                              : item,
                          ),
                        }));
                        event.target.value = "";
                      }}
                    >
                      <option value="">Select a product…</option>
                      {products.map((product) => (
                        <option key={product.publicId} value={product.publicId}>
                          {product.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Link
                    href={`/tenants/${tenantId}/catalogue/products/new`}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium"
                  >
                    New product
                  </Link>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {savedMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {savedMessage}
        </p>
      ) : null}

      {isEditMode && form.publicId ? (
        <MenuPublishPanel
          tenantId={tenantId}
          menuPublicId={form.publicId}
          menuVersion={form.version}
          assignedLocationIds={form.locationIds}
          locations={locations}
        />
      ) : null}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
        <p className="text-sm text-zinc-600">
          {isDirty ? "Unsaved changes" : "All changes saved locally"}
          {form.publicId ? (
            <>
              {" "}
              · Menu <code>{form.publicId}</code> · Version {form.version}
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
            onClick={() => void saveMenu()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
