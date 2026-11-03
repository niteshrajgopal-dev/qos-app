"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AiPhotoGenerator } from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-generator";
import {
  AI_PHOTO_POLL_INTERVAL_MS,
  hasWorkInFlight,
  itemsNeedPhotosLabel,
  menuPhotoSummary,
  mergeServerProgress,
  progressFromCandidates,
  thumbnailsByProduct,
  type ItemProgress,
} from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-view";
import { MenuHealthPanel } from "@/app/tenants/[tenantId]/catalogue/menus/menu-health-panel";
import { MenuPublishPanel } from "@/app/tenants/[tenantId]/catalogue/menus/menu-publish-panel";
import {
  menusCopy,
  menusCount,
  type MenusCopyKey,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { ConfirmDialog } from "@/components/Modal";
import { publicProductThumbnailUrl } from "@/components/platform/catalogue-products-list";
import {
  PortalField,
  PortalNotice,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { Toast, ToastStack } from "@/components/Toast";
import { Checkbox } from "@/design-system/components/primitives/Checkbox";
import { Switch } from "@/design-system/components/primitives/Switch";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import type { MenuAiPhotosView } from "@/lib/media/ai-photos/ai-photo-candidates";
import {
  fetchCatalogueProductVersion,
  removeProductPrimaryPhotoClient,
} from "@/lib/media/remove-product-primary-photo-client";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

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
  const { locale } = useStaffLocale();
  const copy = (key: MenusCopyKey, values?: Record<string, string | number>) =>
    menusCopy(locale, key, values);
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
  const [aiPhotosError, setAiPhotosError] = useState<string | null>(null);
  const [photoProgress, setPhotoProgress] = useState<Record<string, ItemProgress>>({});
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [removingRowPhoto, setRemovingRowPhoto] = useState<string | null>(null);
  const [pendingRemoveRowPhotoProductId, setPendingRemoveRowPhotoProductId] = useState<string | null>(
    null,
  );

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
      throw new Error(productsPayload.error ?? menusCopy(locale, "unableToLoadProducts"));
    }

    if (!locationsResponse.ok) {
      throw new Error(locationsPayload.error ?? menusCopy(locale, "unableToLoadLocations"));
    }

    setProducts(productsPayload.products ?? []);
    setLocations(locationsPayload.locations ?? []);
  }, [locale, tenantId]);

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
        throw new Error(payload.error ?? menusCopy(locale, "unableToLoadMenu"));
      }

      if (!payload.menu) {
        throw new Error(menusCopy(locale, "menuPayloadMissing"));
      }

      applyMenuPayload(payload.menu);
    } finally {
      setLoading(false);
    }
  }, [applyMenuPayload, loadSupportData, locale, menuPublicId, tenantId]);

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
        error?: string;
      };
      if (response.ok && payload.aiPhotos) {
        const view = payload.aiPhotos;
        setAiPhotos(view);
        setAiPhotosError(null);
        setPhotoProgress((current) =>
          mergeServerProgress(current, progressFromCandidates(view.candidates, locale)),
        );
      } else {
        setAiPhotosError(
          payload.error
            ? menusCopy(locale, "aiPhotosLoadFailedHttpDetail", {
                status: response.status,
                detail: payload.error,
              })
            : menusCopy(locale, "aiPhotosLoadFailedHttp", { status: response.status }),
        );
      }
    } catch {
      // AI photos are optional; the editor works without them.
      setAiPhotosError(menusCopy(locale, "aiPhotosLoadFailedNetwork"));
    }
  }, [locale, savedMenuPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAiPhotos(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAiPhotos]);

  const queuedWorkInFlight =
    aiPhotos?.availability.executionMode === "queued_worker" && hasWorkInFlight(photoProgress);
  useEffect(() => {
    if (!queuedWorkInFlight) {
      return;
    }
    const timer = window.setInterval(() => void loadAiPhotos(), AI_PHOTO_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadAiPhotos, queuedWorkInFlight]);

  const refreshPhotos = useCallback(() => {
    setHealthRefreshKey((key) => key + 1);
    void loadAiPhotos();
  }, [loadAiPhotos]);

  async function removeMenuRowPhoto(productPublicId: string) {
    setRemovingRowPhoto(productPublicId);
    setError(null);
    try {
      const version = await fetchCatalogueProductVersion(tenantId, productPublicId);
      await removeProductPrimaryPhotoClient(tenantId, productPublicId, version);
      refreshPhotos();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : copy("unableToRemovePhoto"),
      );
    } finally {
      setRemovingRowPhoto(null);
    }
  }

  const setItemProgress = useCallback((productPublicId: string, next: ItemProgress | null) => {
    setPhotoProgress((current) => {
      if (next === null) {
        const { [productPublicId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [productPublicId]: next };
    });
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
          : copy("unableToPrepareEditor"),
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
          throw new Error(payload.error ?? copy("unableToSaveMenu"));
        }

        if (!payload.menu) {
          throw new Error(copy("savedPayloadMissing"));
        }

        applyMenuPayload(payload.menu);
        setSavedMessage(copy("draftMenuSaved"));
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
        throw new Error(payload.error ?? copy("unableToCreateMenu"));
      }

      if (!payload.menu) {
        throw new Error(copy("createdPayloadMissing"));
      }

      applyMenuPayload(payload.menu);
      setSavedMessage(copy("draftMenuCreated", { id: payload.menu.publicId }));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : copy("unableToSaveMenu"),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!hasLoaded && !loading) {
    return (
      <PortalPanel>
        <div className="qosp-stack">
          <p className="qosp-meta-line">
            {copy(isEditMode ? "loadPromptEdit" : "loadPromptNew")}
          </p>
          <div className="qosp-button-row">
            <button
              type="button"
              onClick={() =>
                void (isEditMode ? loadMenu() : prepareNewMenu()).catch(
                  (loadError) => {
                    setError(
                      loadError instanceof Error
                        ? loadError.message
                        : copy("unableToLoadEditor"),
                    );
                  },
                )
              }
              className="qos-btn"
              data-variant="secondary"
            >
              {copy(isEditMode ? "loadMenu" : "startNewMenu")}
            </button>
          </div>
          {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
        </div>
      </PortalPanel>
    );
  }

  if (loading) {
    return (
      <PortalPanel>
        <p className="qosp-meta-line" role="status">
          {copy("loadingMenu")}
        </p>
      </PortalPanel>
    );
  }

  return (
    <div className="qosp-editor">
      {isEditMode && form.publicId ? (
        <MenuHealthPanel
          tenantId={tenantId}
          menuPublicId={form.publicId}
          menuVersion={form.version}
          refreshKey={healthRefreshKey}
          onReport={setHealthReport}
        />
      ) : null}

      <section className="qosp-editor-section qosp-glass" aria-labelledby="menu-details-title">
        <h2 id="menu-details-title" className="qosp-panel-title">
          {copy("menuDetails")}
        </h2>
        <p className="qosp-panel-help">{copy("menuDetailsHelp")}</p>
        <div className="qosp-panel-body qosp-form-grid">
          <PortalField label={copy("internalName")}>
            <input
              className="qos-input"
              dir="ltr"
              value={form.internalName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  internalName: event.target.value,
                }))
              }
            />
          </PortalField>
          <div className="qosp-form-grid" data-columns="2">
            <PortalField label={copy("englishMenuName")}>
              <input
                className="qos-input"
                dir="ltr"
                lang="en"
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
            </PortalField>
            <PortalField label={copy("arabicMenuName")}>
              <input
                className="qos-input"
                dir="rtl"
                lang="ar"
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
            </PortalField>
          </div>
          <fieldset className="qosp-choice-group">
            <legend className="qosp-field-label">{copy("locations")}</legend>
            {locations.length > 0 ? (
              <div className="qosp-choice-row">
                {locations.map((location) => {
                  const checked = form.locationIds.includes(location.id);
                  return (
                    <Checkbox
                      key={location.id}
                      label={location.name}
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
                  );
                })}
              </div>
            ) : (
              <p className="qosp-meta-line">{copy("noLocations")}</p>
            )}
          </fieldset>
        </div>
      </section>

      <section className="qosp-editor-section qosp-glass" aria-labelledby="menu-sections-title">
        <div className="qosp-section-head">
          <div>
            <h2 id="menu-sections-title" className="qosp-panel-title">
              {copy("sections")}
            </h2>
            <p className="qosp-panel-help">{copy("sectionsHelp")}</p>
          </div>
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
            className="qos-btn"
            data-variant="secondary"
          >
            {copy("addSection")}
          </button>
        </div>

        <div className="qosp-panel-body qosp-stack">
          {form.sections.map((section, sectionIndex) => {
            const sectionName =
              (locale === "ar" ? section.translations.ar.displayName : "") ||
              section.translations.en.displayName ||
              section.internalName ||
              copy("untitledSection");
            const itemCount = menusCount(locale, "items", section.products.length);
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
                      {section.archived ? `${itemCount} · ${copy("hidden")}` : itemCount}
                    </div>
                  </button>
                  <Switch
                    label={<span className="sr-only">{copy("showOnMenu", { name: sectionName })}</span>}
                    checked={!section.archived}
                    onChange={() => updateSection(sectionIndex, (item) => ({ ...item, archived: !item.archived }))}
                  />
                  <IconButton icon="arrow-up" label={copy("moveNamedUp", { name: sectionName })} size="sm" disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} />
                  <IconButton icon="arrow-down" label={copy("moveNamedDown", { name: sectionName })} size="sm" disabled={sectionIndex === form.sections.length - 1} onClick={() => moveSection(sectionIndex, 1)} />
                  <IconButton
                    icon={section.collapsed ? "chevron-down" : "chevron-up"}
                    label={copy(section.collapsed ? "expandNamed" : "collapseNamed", { name: sectionName })}
                    size="sm"
                    onClick={() => updateSection(sectionIndex, (item) => ({ ...item, collapsed: !item.collapsed }))}
                  />
                </div>

                {!section.collapsed ? (
                  <div className="qos-menu-section-body">
                    {section.products.length > 0 ? (
                      <ul className="qos-menu-rows qosp-plain-list">
                        {section.products.map((product, productIndex) => {
                          const thumbnailPublicId = thumbnails.get(product.productPublicId) ?? null;
                          const rowMeta = [
                            product.archived ? copy("hidden") : null,
                            thumbnailPublicId ? null : copy("noPhoto"),
                          ].filter(Boolean);
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
                                    <span className="qos-thumb-tag" title={staffUiCopy(locale, "aiGeneratedImageTitle")}>AI</span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="qos-thumb" data-empty="true" title={copy("noPhoto")}>
                                  <Icon name="camera" size={16} />
                                </span>
                              )}
                              <div className="qos-menu-row-main">
                                <div className="qos-menu-row-name">
                                  <span className="qos-status-dot" data-off={product.archived || undefined} aria-hidden="true" />
                                  {product.displayName}
                                </div>
                                <div className="qos-menu-row-meta">
                                  {rowMeta.length > 0 ? `${rowMeta.join(" · ")} · ` : ""}
                                  <code dir="ltr">{product.productPublicId}</code>
                                </div>
                              </div>
                              <div className="qos-menu-row-actions">
                                {thumbnailPublicId && aiPhotoProducts.has(product.productPublicId) ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    loading={removingRowPhoto === product.productPublicId}
                                    onClick={() => setPendingRemoveRowPhotoProductId(product.productPublicId)}
                                  >
                                    {staffUiCopy(locale, "removeProductPhoto")}
                                  </Button>
                                ) : null}
                                <Switch
                                  label={<span className="sr-only">{copy("showOnMenu", { name: product.displayName })}</span>}
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
                                <IconButton icon="arrow-up" label={copy("moveNamedUp", { name: product.displayName })} size="sm" disabled={productIndex === 0} onClick={() => moveProduct(sectionIndex, productIndex, -1)} />
                                <IconButton icon="arrow-down" label={copy("moveNamedDown", { name: product.displayName })} size="sm" disabled={productIndex === section.products.length - 1} onClick={() => moveProduct(sectionIndex, productIndex, 1)} />
                                <IconButton
                                  icon="trash-2"
                                  label={copy("removeNamed", { name: product.displayName })}
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
                      <p className="qosp-meta-line">{copy("noItemsInSection")}</p>
                    )}

                    <div className="qosp-attach-row">
                      <PortalField label={copy("addProduct")}>
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
                          <option value="">{copy("selectProduct")}</option>
                          {products.map((product) => (
                            <option key={product.publicId} value={product.publicId}>
                              {product.displayName}
                            </option>
                          ))}
                        </select>
                      </PortalField>
                      <Link
                        href={`/tenants/${tenantId}/catalogue/products/new`}
                        className="qos-btn"
                        data-variant="secondary"
                      >
                        {staffUiCopy(locale, "newProduct")}
                      </Link>
                    </div>

                    <details className="qosp-details">
                      <summary>{copy("sectionNames")}</summary>
                      <div className="qosp-form-grid" data-columns="2">
                        <PortalField label={copy("internalSectionName")}>
                          <input
                            className="qos-input"
                            dir="ltr"
                            value={section.internalName}
                            onChange={(event) =>
                              updateSection(sectionIndex, (item) => ({ ...item, internalName: event.target.value }))
                            }
                          />
                        </PortalField>
                        <PortalField label={copy("englishSectionLabel")}>
                          <input
                            className="qos-input"
                            dir="ltr"
                            lang="en"
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
                        </PortalField>
                        <div className="qosp-span-full">
                          <PortalField label={copy("arabicSectionLabel")}>
                            <input
                              className="qos-input"
                              dir="rtl"
                              lang="ar"
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
                          </PortalField>
                        </div>
                      </div>
                    </details>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}

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
        title={staffUiCopy(locale, "discardUnsavedMenuTitle")}
        description={staffUiCopy(locale, "discardUnsavedProductDescription")}
        confirmLabel={staffUiCopy(locale, "discard")}
        cancelLabel={staffUiCopy(locale, "keepEditing")}
        onClose={() => setDiscardOpen(false)}
        onConfirm={resetForm}
      />

      <ConfirmDialog
        open={pendingRemoveRowPhotoProductId !== null}
        tone="danger"
        title={staffUiCopy(locale, "removeProductPhotoConfirmTitle")}
        description={staffUiCopy(locale, "removeProductPhotoConfirmDescription")}
        confirmLabel={staffUiCopy(locale, "removeProductPhotoConfirmLabel")}
        cancelLabel={staffUiCopy(locale, "cancel")}
        onClose={() => setPendingRemoveRowPhotoProductId(null)}
        onConfirm={() => {
          const productPublicId = pendingRemoveRowPhotoProductId;
          setPendingRemoveRowPhotoProductId(null);
          if (productPublicId) {
            void removeMenuRowPhoto(productPublicId);
          }
        }}
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
          aiPhotosError={aiPhotosError}
          progress={photoProgress}
          onProgress={setItemProgress}
          onChanged={refreshPhotos}
        />
      ) : null}

      <div className="qosp-savebar-stack">
        {isEditMode && photoSummary && photoSummary.needPhotos > 0 && !photoSheetOpen ? (
          <div className="qos-ai-bar" role="region" aria-label={copy("aiPhotosRegion")}>
            <span className="qos-ai-bar-icon" aria-hidden="true">
              <Icon name="sparkles" size={20} />
            </span>
            <div className="qos-ai-bar-text">
              <div className="qos-ai-bar-title">{itemsNeedPhotosLabel(photoSummary.needPhotos, locale)}</div>
              <div className="qos-ai-bar-sub">{copy("aiBarSub")}</div>
            </div>
            <Button size="sm" icon="sparkles" onClick={() => setPhotoSheetOpen(true)}>
              {copy("generate")}
            </Button>
          </div>
        ) : null}
        <div className="qosp-savebar">
          <p>
            {isDirty
              ? staffUiCopy(locale, "productEditorUnsavedChanges")
              : staffUiCopy(locale, "productEditorAllSavedLocally")}
            {form.publicId ? (
              <>
                {" "}
                · {copy("menuLabel")}{" "}
                <code className="qosp-code" dir="ltr">{form.publicId}</code> ·{" "}
                {copy("versionLabel")} {form.version}
              </>
            ) : null}
          </p>
          <div className="qosp-button-row">
            <button
              type="button"
              onClick={requestResetForm}
              disabled={!isDirty || saving}
              className="qos-btn"
              data-variant="secondary"
            >
              {staffUiCopy(locale, "cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveMenu()}
              className="qos-btn"
              data-variant="primary"
            >
              {saving ? copy("saving") : copy("saveDraft")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
