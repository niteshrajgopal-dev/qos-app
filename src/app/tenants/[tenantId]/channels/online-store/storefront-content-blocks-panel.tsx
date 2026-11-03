"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import {
  blockTypeLabel,
  readLocalizedCopy,
  type ContentBlock,
  type ContentBlocksPreview,
  type LocalizedCopy,
} from "@/app/tenants/[tenantId]/channels/online-store/storefront-view";
import {
  storefrontsCopy,
  type StorefrontsCopyKey,
} from "@/app/tenants/[tenantId]/channels/online-store/storefronts-copy";
import {
  PortalField,
  PortalNotice,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { Checkbox } from "@/design-system";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

type ContentBlocksDraftResponse = {
  storefrontPublicId: string;
  draftVersion: number;
  supportedLocales: string[];
  contentBlocks: ContentBlock[];
};

type StorefrontContentBlocksPanelProps = {
  tenantId: string;
  storefrontPublicId: string;
  isAdministrator: boolean;
  onDraftChange?: (preview: ContentBlocksPreview | null) => void;
};

type CopyField = {
  field: string;
  locale: keyof LocalizedCopy;
  label: StorefrontsCopyKey;
  multiline: boolean;
  wide: boolean;
};

const BLOCK_FIELDS: Record<string, CopyField[]> = {
  hero: [
    { field: "title", locale: "en", label: "titleEn", multiline: false, wide: false },
    { field: "title", locale: "ar", label: "titleAr", multiline: false, wide: false },
    { field: "subtitle", locale: "en", label: "subtitleEn", multiline: true, wide: true },
    { field: "subtitle", locale: "ar", label: "subtitleAr", multiline: true, wide: true },
  ],
  footer: [
    { field: "statement", locale: "en", label: "statementEn", multiline: true, wide: false },
    { field: "statement", locale: "ar", label: "statementAr", multiline: true, wide: false },
  ],
};

function cloneBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return structuredClone(blocks);
}

function writeLocalizedCopy(
  block: ContentBlock,
  field: string,
  locale: keyof LocalizedCopy,
  value: string,
): ContentBlock {
  const current = readLocalizedCopy(block.props[field]);
  return {
    ...block,
    props: {
      ...block.props,
      [field]: {
        ...current,
        [locale]: value,
      },
    },
  };
}

export function StorefrontContentBlocksPanel({
  tenantId,
  storefrontPublicId,
  isAdministrator,
  onDraftChange,
}: StorefrontContentBlocksPanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: StorefrontsCopyKey, values?: Record<string, string | number>) =>
    storefrontsCopy(locale, key, values);
  const [loaded, setLoaded] = useState<ContentBlocksDraftResponse | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDraft = useEffectEvent(async () => {
    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefrontPublicId}/content-blocks-draft`,
      );
      const payload = (await response.json()) as {
        contentBlocksDraft?: ContentBlocksDraftResponse;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToLoadBlocks"));
      }

      const draft = payload.contentBlocksDraft!;
      setLoaded(draft);
      setBlocks(cloneBlocks(draft.contentBlocks));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : storefrontsCopy(locale, "unableToLoadBlocks"),
      );
    } finally {
      setBusy(false);
    }
  });

  // Not keyed on locale: reloading on a language switch would discard unsaved edits.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDraft();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storefrontPublicId, tenantId]);

  const supportedLocales = loaded?.supportedLocales;
  useEffect(() => {
    onDraftChange?.(supportedLocales ? { supportedLocales, blocks } : null);
  }, [blocks, onDraftChange, supportedLocales]);

  const isDirty = useMemo(() => {
    if (!loaded) {
      return false;
    }

    return JSON.stringify(loaded.contentBlocks) !== JSON.stringify(blocks);
  }, [blocks, loaded]);

  const moveBlock = useCallback((index: number, direction: -1 | 1) => {
    setBlocks((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!loaded) {
      return;
    }

    if (!isAdministrator) {
      setError(storefrontsCopy(locale, "adminRequiredSaveBlocks"));
      return;
    }

    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefrontPublicId}/content-blocks-draft`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: loaded.draftVersion,
            contentBlocks: blocks,
          }),
        },
      );

      const payload = (await response.json()) as {
        contentBlocksDraft?: {
          draftVersion: number;
          contentBlocks: ContentBlock[];
        };
        error?: string;
        issues?: Array<{ field: string; message: string }>;
      };

      if (!response.ok) {
        setIssues(payload.issues ?? []);
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToSaveBlocks"));
      }

      const saved = payload.contentBlocksDraft!;
      setLoaded({
        ...loaded,
        draftVersion: saved.draftVersion,
        contentBlocks: saved.contentBlocks,
      });
      setBlocks(cloneBlocks(saved.contentBlocks));
      setMessage(storefrontsCopy(locale, "blocksSaved"));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : storefrontsCopy(locale, "unableToSaveBlocks"),
      );
    } finally {
      setBusy(false);
    }
  }, [blocks, isAdministrator, loaded, locale, storefrontPublicId, tenantId]);

  const titleId = `storefront-blocks-${storefrontPublicId}`;

  if (!loaded) {
    return (
      <PortalPanel>
        <h2 className="qosp-panel-title">{copy("blocksTitle")}</h2>
        {error ? (
          <div className="qosp-panel-body">
            <PortalNotice tone="error">{error}</PortalNotice>
          </div>
        ) : (
          <p className="qosp-panel-help" role="status">
            {copy("blocksLoading")}
          </p>
        )}
      </PortalPanel>
    );
  }

  return (
    <section className="qosp-glass qosp-sf-section" aria-labelledby={titleId}>
      <div className="qosp-sf-head">
        <div className="qosp-sf-head-text">
          <h2 id={titleId} className="qosp-panel-title">
            {copy("blocksTitle")}
          </h2>
          <p className="qosp-panel-help">
            {copy("blocksHelp", { version: loaded.draftVersion })}
          </p>
        </div>
        <div className="qosp-button-row">
          <button
            type="button"
            disabled={busy || !isDirty}
            onClick={() => setBlocks(cloneBlocks(loaded.contentBlocks))}
            className="qos-btn"
            data-variant="secondary"
          >
            {staffUiCopy(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !isAdministrator || !isDirty}
            onClick={() => void saveDraft()}
            className="qos-btn"
            data-variant="primary"
          >
            {busy && isDirty ? copy("saving") : copy("saveDraft")}
          </button>
        </div>
      </div>

      {isDirty ? <PortalNotice tone="warning">{copy("blocksUnsaved")}</PortalNotice> : null}
      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {message ? <PortalNotice tone="success">{message}</PortalNotice> : null}
      {issues.length > 0 ? (
        <div className="qosp-notice" data-tone="error" role="alert">
          <ul className="qosp-sf-issues">
            {issues.map((issue) => (
              <li key={`${issue.field}:${issue.message}`}>
                {copy("issueLine", { field: issue.field, message: issue.message })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol className="qosp-sf-blocks">
        {blocks.map((block, index) => {
          const name = blockTypeLabel(locale, block.type);
          const fields = BLOCK_FIELDS[block.type];
          const headingId = `storefront-block-${storefrontPublicId}-${block.id}`;

          return (
            <li key={block.id}>
              <article className="qosp-subcard qosp-sf-block" aria-labelledby={headingId}>
                <div className="qosp-sf-block-head">
                  <div className="qosp-sf-head-text">
                    <h3 id={headingId} className="qosp-subcard-title">
                      {name}
                    </h3>
                    <p className="qosp-meta-line">
                      <span className="qosp-code" dir="ltr">
                        {block.id}
                      </span>{" "}
                      {copy("blockSchema", { version: block.schemaVersion })}
                    </p>
                  </div>
                  <div className="qosp-button-row">
                    <Checkbox
                      label={copy("blockVisible")}
                      checked={block.visible}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, visible: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      disabled={!isAdministrator || busy || index === 0}
                      onClick={() => moveBlock(index, -1)}
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      aria-label={copy("moveBlockUp", { name })}
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                      {copy("moveUp")}
                    </button>
                    <button
                      type="button"
                      disabled={!isAdministrator || busy || index === blocks.length - 1}
                      onClick={() => moveBlock(index, 1)}
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      aria-label={copy("moveBlockDown", { name })}
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                      {copy("moveDown")}
                    </button>
                  </div>
                </div>

                {fields ? (
                  <div className="qosp-form-grid" data-columns="2">
                    {fields.map((field) => {
                      const value = readLocalizedCopy(block.props[field.field])[field.locale];
                      const onChange = (next: string) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(entry, field.field, field.locale, next)
                              : entry,
                          ),
                        );
                      return (
                        <div
                          key={`${field.field}-${field.locale}`}
                          className={field.wide ? "qosp-span-full" : undefined}
                        >
                          <PortalField label={copy(field.label)}>
                            {field.multiline ? (
                              <textarea
                                className="qos-textarea"
                                dir={field.locale === "ar" ? "rtl" : "ltr"}
                                lang={field.locale}
                                value={value}
                                disabled={!isAdministrator || busy}
                                onChange={(event) => onChange(event.target.value)}
                              />
                            ) : (
                              <input
                                className="qos-input"
                                dir={field.locale === "ar" ? "rtl" : "ltr"}
                                lang={field.locale}
                                value={value}
                                disabled={!isAdministrator || busy}
                                onChange={(event) => onChange(event.target.value)}
                              />
                            )}
                          </PortalField>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="qosp-meta-line">{copy("blockNoEditor", { type: name })}</p>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
