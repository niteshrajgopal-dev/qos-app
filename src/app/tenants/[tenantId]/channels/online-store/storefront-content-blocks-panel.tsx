"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type LocalizedCopy = {
  en: string;
  ar: string;
};

type ContentBlock = {
  id: string;
  type: string;
  schemaVersion: number;
  visible: boolean;
  props: Record<string, unknown>;
};

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
};

function cloneBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return structuredClone(blocks);
}

function readLocalizedCopy(value: unknown): LocalizedCopy {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      en: typeof record.en === "string" ? record.en : "",
      ar: typeof record.ar === "string" ? record.ar : "",
    };
  }

  return { en: "", ar: "" };
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
}: StorefrontContentBlocksPanelProps) {
  const [loaded, setLoaded] = useState<ContentBlocksDraftResponse | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDraft = useCallback(async () => {
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
        throw new Error(payload.error ?? "Unable to load content blocks.");
      }

      const draft = payload.contentBlocksDraft!;
      setLoaded(draft);
      setBlocks(cloneBlocks(draft.contentBlocks));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load content blocks.",
      );
    } finally {
      setBusy(false);
    }
  }, [storefrontPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDraft();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDraft]);

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
      setError("Administrator membership is required to save content blocks.");
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
        throw new Error(payload.error ?? "Unable to save content blocks.");
      }

      const saved = payload.contentBlocksDraft!;
      setLoaded({
        ...loaded,
        draftVersion: saved.draftVersion,
        contentBlocks: saved.contentBlocks,
      });
      setBlocks(cloneBlocks(saved.contentBlocks));
      setMessage("Content block draft saved. Publish to update the live storefront.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save content blocks.",
      );
    } finally {
      setBusy(false);
    }
  }, [blocks, isAdministrator, loaded, storefrontPublicId, tenantId]);

  if (!loaded) {
    return (
      <section className="qos-card" data-padding="md">
        <h2 className="text-lg font-semibold text-zinc-900">Content blocks</h2>
        <p className="mt-2 text-sm text-zinc-600">
          {error ?? "Load the online store to edit storefront content blocks."}
        </p>
      </section>
    );
  }

  return (
    <section className="qos-card" data-padding="md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Content blocks</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Draft v{loaded.draftVersion}. Reorder, hide, or edit bilingual copy
            without changing the live release.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setBlocks(cloneBlocks(loaded.contentBlocks))}
            className="qos-btn" data-variant="secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !isAdministrator || !isDirty}
            onClick={() => void saveDraft()}
            className="qos-btn" data-variant="primary"
          >
            Save draft
          </button>
        </div>
      </div>

      {isDirty ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have unsaved content block changes.
        </p>
      ) : null}

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      {issues.length > 0 ? (
        <ul className="qos-alert" data-tone="error">
          {issues.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>
              <span className="font-medium">{issue.field}</span>: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-4">
        {blocks.map((block, index) => {
          const title = readLocalizedCopy(block.props.title);
          const subtitle = readLocalizedCopy(block.props.subtitle);
          const statement = readLocalizedCopy(block.props.statement);

          return (
            <article
              key={block.id}
              className="space-y-3 rounded-lg border border-zinc-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-900">
                    {block.type} · {block.id}
                  </p>
                  <p className="text-sm text-zinc-600">
                    Schema v{block.schemaVersion}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
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
                    Visible
                  </label>
                  <button
                    type="button"
                    disabled={!isAdministrator || busy || index === 0}
                    onClick={() => moveBlock(index, -1)}
                    className="qos-btn" data-variant="ghost" data-size="sm"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={!isAdministrator || busy || index === blocks.length - 1}
                    onClick={() => moveBlock(index, 1)}
                    className="qos-btn" data-variant="ghost" data-size="sm"
                  >
                    Move down
                  </button>
                </div>
              </div>

              {block.type === "hero" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Title (EN)</span>
                    <input
                      className="qos-input"
                      value={title.en}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(
                                  entry,
                                  "title",
                                  "en",
                                  event.target.value,
                                )
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Title (AR)</span>
                    <input
                      dir="rtl"
                      className="qos-input"
                      value={title.ar}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(
                                  entry,
                                  "title",
                                  "ar",
                                  event.target.value,
                                )
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="font-medium text-zinc-700">Subtitle (EN)</span>
                    <textarea
                      className="qos-textarea"
                      value={subtitle.en}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(
                                  entry,
                                  "subtitle",
                                  "en",
                                  event.target.value,
                                )
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="font-medium text-zinc-700">Subtitle (AR)</span>
                    <textarea
                      dir="rtl"
                      className="qos-textarea"
                      value={subtitle.ar}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(
                                  entry,
                                  "subtitle",
                                  "ar",
                                  event.target.value,
                                )
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ) : block.type === "footer" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Statement (EN)</span>
                    <textarea
                      className="qos-textarea"
                      value={statement.en}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(
                                  entry,
                                  "statement",
                                  "en",
                                  event.target.value,
                                )
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Statement (AR)</span>
                    <textarea
                      dir="rtl"
                      className="qos-textarea"
                      value={statement.ar}
                      disabled={!isAdministrator || busy}
                      onChange={(event) =>
                        setBlocks((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? writeLocalizedCopy(
                                  entry,
                                  "statement",
                                  "ar",
                                  event.target.value,
                                )
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ) : (
                <p className="text-sm text-zinc-600">
                  Editing for {block.type} blocks is validated on save. Extend this
                  panel as additional block editors are added.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
