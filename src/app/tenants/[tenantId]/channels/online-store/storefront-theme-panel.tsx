"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ThemeDraft = {
  schemaVersion: number;
  preset: "hospitality_baseline" | "generic_retail_baseline";
  colors: {
    primary: string;
    accent: string;
    background: string;
    text: string;
  };
  typography: {
    body: "inter" | "system-ui";
    display: "young-serif" | "system-ui";
  };
  logo?: {
    publicDerivativeId: string;
  };
};

type ThemeDraftResponse = {
  storefrontPublicId: string;
  draftVersion: number;
  theme: ThemeDraft;
  tenantDefaultTheme: ThemeDraft;
  activeReleaseTheme: Record<string, unknown> | null;
};

type StorefrontThemePanelProps = {
  tenantId: string;
  storefrontPublicId: string;
  isAdministrator: boolean;
};

function cloneTheme(theme: ThemeDraft): ThemeDraft {
  return structuredClone(theme);
}

export function StorefrontThemePanel({
  tenantId,
  storefrontPublicId,
  isAdministrator,
}: StorefrontThemePanelProps) {
  const [loaded, setLoaded] = useState<ThemeDraftResponse | null>(null);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadThemeDraft = useCallback(async () => {
    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefrontPublicId}/theme-draft`,
      );
      const payload = (await response.json()) as {
        themeDraft?: ThemeDraftResponse;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load theme draft.");
      }

      const themeDraft = payload.themeDraft!;
      setLoaded(themeDraft);
      setDraft(cloneTheme(themeDraft.theme));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load theme draft.",
      );
    } finally {
      setBusy(false);
    }
  }, [storefrontPublicId, tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThemeDraft();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThemeDraft]);

  const isDirty = useMemo(() => {
    if (!loaded || !draft) {
      return false;
    }

    return JSON.stringify(loaded.theme) !== JSON.stringify(draft);
  }, [draft, loaded]);

  const saveDraft = useCallback(async () => {
    if (!loaded || !draft) {
      return;
    }

    if (!isAdministrator) {
      setError("Administrator membership is required to save theme drafts.");
      return;
    }

    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefrontPublicId}/theme-draft`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: loaded.draftVersion,
            theme: draft,
          }),
        },
      );

      const payload = (await response.json()) as {
        themeDraft?: {
          draftVersion: number;
          theme: ThemeDraft;
        };
        error?: string;
        issues?: Array<{ field: string; message: string }>;
      };

      if (!response.ok) {
        setIssues(payload.issues ?? []);
        throw new Error(payload.error ?? "Unable to save theme draft.");
      }

      const saved = payload.themeDraft!;
      setLoaded({
        ...loaded,
        draftVersion: saved.draftVersion,
        theme: saved.theme,
      });
      setDraft(cloneTheme(saved.theme));
      setMessage("Theme draft saved. Publish to update the live storefront.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save theme draft.",
      );
    } finally {
      setBusy(false);
    }
  }, [draft, isAdministrator, loaded, storefrontPublicId, tenantId]);

  const resetToDefault = useCallback(async () => {
    if (!loaded) {
      return;
    }

    if (!isAdministrator) {
      setError("Administrator membership is required to reset theme drafts.");
      return;
    }

    setBusy(true);
    setError(null);
    setIssues([]);
    setMessage(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/storefronts/${storefrontPublicId}/theme-draft`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: loaded.draftVersion,
            resetToDefault: true,
          }),
        },
      );

      const payload = (await response.json()) as {
        themeDraft?: {
          draftVersion: number;
          theme: ThemeDraft;
        };
        error?: string;
        issues?: Array<{ field: string; message: string }>;
      };

      if (!response.ok) {
        setIssues(payload.issues ?? []);
        throw new Error(payload.error ?? "Unable to reset theme draft.");
      }

      const saved = payload.themeDraft!;
      setLoaded({
        ...loaded,
        draftVersion: saved.draftVersion,
        theme: saved.theme,
      });
      setDraft(cloneTheme(saved.theme));
      setMessage("Theme draft reset to tenant default.");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Unable to reset theme draft.",
      );
    } finally {
      setBusy(false);
    }
  }, [isAdministrator, loaded, storefrontPublicId, tenantId]);

  if (!loaded || !draft) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-900">Theme draft</h2>
        <p className="mt-2 text-sm text-zinc-600">
          {error ?? "Load the online store to edit storefront branding."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Theme draft</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Draft v{loaded.draftVersion}. Live release keeps its current theme
            until you publish.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => loaded && setDraft(cloneTheme(loaded.theme))}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !isAdministrator}
            onClick={() => void resetToDefault()}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Reset to default
          </button>
          <button
            type="button"
            disabled={busy || !isAdministrator || !isDirty}
            onClick={() => void saveDraft()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save draft
          </button>
        </div>
      </div>

      {isDirty ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have unsaved theme changes.
        </p>
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

      {issues.length > 0 ? (
        <ul className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {issues.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>
              <span className="font-medium">{issue.field}</span>: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Preset</span>
          <select
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={draft.preset}
            disabled={!isAdministrator || busy}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      preset: event.target.value as ThemeDraft["preset"],
                    }
                  : current,
              )
            }
          >
            <option value="hospitality_baseline">Hospitality baseline</option>
            <option value="generic_retail_baseline">Retail baseline</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Logo media ID</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={draft.logo?.publicDerivativeId ?? ""}
            disabled={!isAdministrator || busy}
            placeholder="mda_..."
            onChange={(event) =>
              setDraft((current) => {
                if (!current) {
                  return current;
                }

                const value = event.target.value.trim();
                if (!value) {
                  const next = { ...current };
                  delete next.logo;
                  return next;
                }

                return {
                  ...current,
                  logo: { publicDerivativeId: value },
                };
              })
            }
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["primary", "accent", "background", "text"] as const).map((token) => (
          <label key={token} className="block text-sm">
            <span className="font-medium capitalize text-zinc-700">{token}</span>
            <input
              type="color"
              className="mt-1 h-11 w-full rounded-lg border border-zinc-300 px-1 py-1"
              value={draft.colors[token]}
              disabled={!isAdministrator || busy}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        colors: {
                          ...current.colors,
                          [token]: event.target.value.toUpperCase(),
                        },
                      }
                    : current,
                )
              }
            />
          </label>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Body font</span>
          <select
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={draft.typography.body}
            disabled={!isAdministrator || busy}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      typography: {
                        ...current.typography,
                        body: event.target.value as ThemeDraft["typography"]["body"],
                      },
                    }
                  : current,
              )
            }
          >
            <option value="inter">Inter</option>
            <option value="system-ui">System UI</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Display font</span>
          <select
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={draft.typography.display}
            disabled={!isAdministrator || busy}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      typography: {
                        ...current.typography,
                        display: event.target
                          .value as ThemeDraft["typography"]["display"],
                      },
                    }
                  : current,
              )
            }
          >
            <option value="young-serif">Young Serif</option>
            <option value="system-ui">System UI</option>
          </select>
        </label>
      </div>

      <div
        className="rounded-lg border border-zinc-200 p-4"
        style={{
          background: draft.colors.background,
          color: draft.colors.text,
        }}
      >
        <p className="text-xs uppercase tracking-wide opacity-70">Draft preview</p>
        <p
          className="mt-2 text-2xl"
          style={{ color: draft.colors.primary, fontFamily: "serif" }}
        >
          Storefront headline
        </p>
        <p className="mt-2 text-sm">
          Body copy preview with accent{" "}
          <span style={{ color: draft.colors.accent }}>highlight</span>.
        </p>
      </div>
    </section>
  );
}
