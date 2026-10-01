"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AiPhotoGenerator } from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-generator";
import {
  itemsNeedPhotosLabel,
  menuPhotoSummary,
  progressFromCandidates,
  thumbnailsByProduct,
  type ItemProgress,
} from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-view";
import { MenuHealthPanel } from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-panel";
import { MenuPublishPanel } from "@/app/tenants/[tenantId]/catalogue/menus/menu-publish-panel";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { ConfirmDialog } from "@/components/Modal";
import { publicProductThumbnailUrl } from "@/components/platform/catalogue-products-list";
import { Toast, ToastStack } from "@/components/Toast";
import { Switch } from "@/design-system/components/primitives/Switch";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import type { MenuAiPhotosView } from "@/lib/media/ai-photos/ai-photo-candidates";
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
  const [discardOpen, setDiscardOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(!isEditMode);
  const [healthReport, setHealthReport] = useState<MenuHealthReport | null>(null);
  const [healthRefreshKey, setHealthRefreshKey] = useState(0);
  const [aiPhotos, setAiPhotos] = useState<MenuAiPhotosView | null>(null);
  const [photoProgress, setPhotoProgress] = useState<Record<string, ItemProgress>>({});
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);

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

  const savedMenuPublicId = isEditMode ? form.publicId : null;

  const loadAiPhotos = useCallback(async () => {
    if (!savedMenuPublicId) {
      return;
    }
    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/menus/${savedMenuPublicId}/ai-photos`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        aiPhotos?: MenuAiPhotosView;
      };
      if (response.ok && payload.aiPhotos) {
        const view = payload.aiPhotos;
        setAiPhotos(view);
        setPhotoProgress((current) => ({ ...progressFromCandidates(view.candidates), ...current }));
      }
    } catch {
      // AI photos are optional; the editor works without them.
    }
  }, [savedMenuPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAiPhotos(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAiPhotos]);

  const refreshPhotos = useCallback(() => {
    setHealthRefreshKey((key) => key + 1);
    void loadAiPhotos();
  }, [loadAiPhotos]);

  const setItemProgress = useCallback((productPublicId: string, next: ItemProgress) => {
    setPhotoProgress((current) => ({ ...current, [productPublicId]: next }));
  }, []);

  const thumbnails = useMemo(() => thumbnailsByProduct(healthReport), [healthReport]);
  const aiPhotoProducts = useMemo(() => {
    const ids = new Set(aiPhotos?.aiPhotoProductPublicIds ?? []);
    for (const [productPublicId, entry] of Object.entries(photoProgress)) {
      if (entry.state === "accepted") {
        ids.add(productPublicId);
      }
    }
    return ids;
  }, [aiPhotos, photoProgress]);
  const photoSummary = healthReport ? menuPhotoSummary(healthReport) : null;

  function updateSection(sectionIndex: number, update: (section: SectionState) => SectionState) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((item, index) =>
        index === sectionIndex ? update(item) : item,
      ),
    }));
  }

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

  function requestResetForm() {
    if (!isDirty) {
      return;
    }

    setDiscardOpen(true);
  }

  function resetForm() {
    setForm(JSON.parse(baseline) as MenuEditorState);
    setError(null);
    setSavedMessage(null);
    setDiscardOpen(false);
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
          className="qos-btn" data-variant="secondary"
        >
          {isEditMode ? "Load menu" : "Start new menu"}
        </button>
        {error ? (
          <p className="qos-alert" data-tone="error">
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
      {isEditMode && form.publicId ? (
        <MenuHealthPanel
          tenantId={tenantId}
          menuPublicId={form.publicId}
          menuVersion={form.version}
          refreshKey={healthRefreshKey}
          onReport={setHealthReport}
        />
      ) : null}

      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold">Menu details</h2>
        <div className="mt-4 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-700">
              Internal name
            </span>
            <input
              className="qos-input"
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
                className="qos-input"
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
                className="qos-input"
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
            className="qos-btn" data-variant="secondary"
          >
            Add section
          </button>
        </div>

        {form.sections.map((section, sectionIndex) => {
          const sectionName =
            section.translations.en.displayName || section.internalName || "Untitled section";
          return (
          <article key={section.publicId ?? `new-${sectionIndex}`} className="qos-menu-section">
            <div className="qos-menu-section-head">
              <button
                type="button"
                className="qos-menu-section-title"
                aria-expanded={!section.collapsed}
                onClick={() => updateSection(sectionIndex, (item) => ({ ...item, collapsed: !item.collapsed }))}
              >
                <div className="qos-menu-section-name">
                  <span className="qos-status-dot" data-off={section.archived || undefined} aria-hidden="true" />
                  {sectionName}
                </div>
                <div className="qos-menu-row-meta">
                  {section.products.length} {section.products.length === 1 ? "item" : "items"}
                  {section.archived ? " · Hidden" : ""}
                </div>
              </button>
              <Switch
                label={<span className="sr-only">Show {sectionName} on the menu</span>}
                checked={!section.archived}
                onChange={() => updateSection(sectionIndex, (item) => ({ ...item, archived: !item.archived }))}
              />
              <IconButton icon="arrow-up" label={`Move ${sectionName} up`} size="sm" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} />
              <IconButton icon="arrow-down" label={`Move ${sectionName} down`} size="sm" disabled={sectionIndex === form.sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} />
              <IconButton
                icon={section.collapsed ? "chevron-down" : "chevron-up"}
                label={section.collapsed ? `Expand ${sectionName}` : `Collapse ${sectionName}`}
                size="sm"
                onClick={() => updateSection(sectionIndex, (item) => ({ ...item, collapsed: !item.collapsed }))}
              />
            </div>

            {!section.collapsed ? (
              <div className="qos-menu-section-body">
                {section.products.length > 0 ? (
                  <ul className="qos-menu-rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {section.products.map((product, productIndex) => {
                      const thumbnailPublicId = thumbnails.get(product.productPublicId) ?? null;
                      return (
                        <li
                          key={`${product.productPublicId}-${productIndex}`}
                          className="qos-menu-row"
                          data-muted={product.archived || undefined}
                        >
                          {thumbnailPublicId ? (
                            <span className="qos-thumb">
                              {/* eslint-disable-next-line @next/next/no-img-element -- matches catalogue thumbnails */}
                              <img src={publicProductThumbnailUrl(thumbnailPublicId)} alt="" />
                              {aiPhotoProducts.has(product.productPublicId) ? (
                                <span className="qos-thumb-tag" title="AI-generated image">AI</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="qos-thumb" data-empty="true" title="No photo">
                              <Icon name="camera" size={16} />
                            </span>
                          )}
                          <div className="qos-menu-row-main">
                            <div className="qos-menu-row-name">
                              <span className="qos-status-dot" data-off={product.archived || undefined} aria-hidden="true" />
                              {product.displayName}
                            </div>
                            <div className="qos-menu-row-meta">
                              {product.archived ? "Hidden · " : ""}
                              {thumbnailPublicId ? "" : "No photo · "}
                              <code>{product.productPublicId}</code>
                            </div>
                          </div>
                          <div className="qos-menu-row-actions">
                            <Switch
                              label={<span className="sr-only">Show {product.displayName} on the menu</span>}
                              checked={!product.archived}
                              onChange={() =>
                                updateSection(sectionIndex, (item) => ({
                                  ...item,
                                  products: item.products.map((entry, idx) =>
                                    idx === productIndex ? { ...entry, archived: !entry.archived } : entry,
                                  ),
                                }))
                              }
                            />
                            <IconButton icon="arrow-up" label={`Move ${product.displayName} up`} size="sm" disabled={productIndex === 0} onClick={() => moveProduct(sectionIndex, productIndex, -1)} />
                            <IconButton icon="arrow-down" label={`Move ${product.displayName} down`} size="sm" disabled={productIndex === section.products.length - 1} onClick={() => moveProduct(sectionIndex, productIndex, 1)} />
                            <IconButton
                              icon="trash-2"
                              label={`Remove ${product.displayName}`}
                              size="sm"
                              onClick={() =>
                                updateSection(sectionIndex, (item) => ({
                                  ...item,
                                  products: item.products.filter((_, idx) => idx !== productIndex),
                                }))
                              }
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="qos-card-sub">No items in this section yet.</p>
                )}

                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-0 flex-1 space-y-2">
                    <span className="text-sm font-medium text-zinc-700">
                      Add product
                    </span>
                    <select
                      className="qos-input"
                      defaultValue=""
                      onChange={(event) => {
                        const selected = products.find(
                          (product) => product.publicId === event.target.value,
                        );
                        if (!selected) {
                          return;
                        }

                        updateSection(sectionIndex, (item) => ({
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
                    className="qos-btn" data-variant="secondary"
                  >
                    New product
                  </Link>
                </div>

                <details>
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                    Section names
                  </summary>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-zinc-700">
                        Internal section name
                      </span>
                      <input
                        className="qos-input"
                        value={section.internalName}
                        onChange={(event) =>
                          updateSection(sectionIndex, (item) => ({ ...item, internalName: event.target.value }))
                        }
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-zinc-700">
                        English section label
                      </span>
                      <input
                        className="qos-input"
                        value={section.translations.en.displayName}
                        onChange={(event) =>
                          updateSection(sectionIndex, (item) => ({
                            ...item,
                            translations: {
                              ...item.translations,
                              en: { ...item.translations.en, displayName: event.target.value },
                            },
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
                        className="qos-input"
                        value={section.translations.ar.displayName}
                        onChange={(event) =>
                          updateSection(sectionIndex, (item) => ({
                            ...item,
                            translations: {
                              ...item.translations,
                              ar: { ...item.translations.ar, displayName: event.target.value },
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                </details>
              </div>
            ) : null}
          </article>
          );
        })}
      </section>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {savedMessage ? (
        <ToastStack>
          <Toast
            tone="success"
            title={savedMessage}
            onDismiss={() => setSavedMessage(null)}
          />
        </ToastStack>
      ) : null}

      <ConfirmDialog
        open={discardOpen}
        tone="danger"
        title="Discard unsaved changes to this draft menu?"
        description="The current draft will revert to the last saved version."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onClose={() => setDiscardOpen(false)}
        onConfirm={resetForm}
      />

      {isEditMode && form.publicId ? (
        <MenuPublishPanel
          tenantId={tenantId}
          menuPublicId={form.publicId}
          menuVersion={form.version}
          assignedLocationIds={form.locationIds}
          locations={locations}
        />
      ) : null}

      {isEditMode && form.publicId ? (
        <AiPhotoGenerator
          tenantId={tenantId}
          menuPublicId={form.publicId}
          open={photoSheetOpen}
          onClose={() => setPhotoSheetOpen(false)}
          report={healthReport}
          aiPhotos={aiPhotos}
          progress={photoProgress}
          onProgress={setItemProgress}
          onChanged={refreshPhotos}
        />
      ) : null}

      <div className="sticky bottom-4 z-20 grid min-w-0 grid-cols-1 gap-3">
      {isEditMode && photoSummary && photoSummary.needPhotos > 0 && !photoSheetOpen ? (
        <div className="qos-ai-bar" role="region" aria-label="AI photos">
          <span className="qos-ai-bar-icon" aria-hidden="true">
            <Icon name="sparkles" size={20} />
          </span>
          <div className="qos-ai-bar-text">
            <div className="qos-ai-bar-title">{itemsNeedPhotosLabel(photoSummary.needPhotos)}</div>
            <div className="qos-ai-bar-sub">Generate with AI, then review before use</div>
          </div>
          <Button size="sm" icon="sparkles" onClick={() => setPhotoSheetOpen(true)}>
            Generate
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
        <p className="min-w-0 text-sm text-zinc-600">
          {isDirty ? "Unsaved changes" : "All changes saved locally"}
          {form.publicId ? (
            <>
              {" "}
              · Menu <code className="break-all">{form.publicId}</code> · Version {form.version}
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={requestResetForm}
            disabled={!isDirty || saving}
            className="qos-btn" data-variant="secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveMenu()}
            className="qos-btn" data-variant="primary"
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
