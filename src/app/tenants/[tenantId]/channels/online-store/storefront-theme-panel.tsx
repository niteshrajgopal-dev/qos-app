"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import type { ThemeDraft } from "@/app/tenants/[tenantId]/channels/online-store/storefront-view";
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
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

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
  onDraftChange?: (theme: ThemeDraft | null) => void;
};

const COLOR_TOKENS = [
  { token: "primary", key: "colorPrimary" },
  { token: "accent", key: "colorAccent" },
  { token: "background", key: "colorBackground" },
  { token: "text", key: "colorText" },
] as const satisfies ReadonlyArray<{
  token: keyof ThemeDraft["colors"];
  key: StorefrontsCopyKey;
}>;

function cloneTheme(theme: ThemeDraft): ThemeDraft {
  return structuredClone(theme);
}

export function StorefrontThemePanel({
  tenantId,
  storefrontPublicId,
  isAdministrator,
  onDraftChange,
}: StorefrontThemePanelProps) {
  const { locale } = useStaffLocale();
  const copy = (key: StorefrontsCopyKey, values?: Record<string, string | number>) =>
    storefrontsCopy(locale, key, values);
  const [loaded, setLoaded] = useState<ThemeDraftResponse | null>(null);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>(
    [],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadThemeDraft = useEffectEvent(async () => {
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
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToLoadTheme"));
      }

      const themeDraft = payload.themeDraft!;
      setLoaded(themeDraft);
      setDraft(cloneTheme(themeDraft.theme));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : storefrontsCopy(locale, "unableToLoadTheme"),
      );
    } finally {
      setBusy(false);
    }
  });

  // Not keyed on locale: reloading on a language switch would discard unsaved edits.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadThemeDraft();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storefrontPublicId, tenantId]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

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
      setError(storefrontsCopy(locale, "adminRequiredSaveTheme"));
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
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToSaveTheme"));
      }

      const saved = payload.themeDraft!;
      setLoaded({
        ...loaded,
        draftVersion: saved.draftVersion,
        theme: saved.theme,
      });
      setDraft(cloneTheme(saved.theme));
      setMessage(storefrontsCopy(locale, "themeSaved"));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : storefrontsCopy(locale, "unableToSaveTheme"),
      );
    } finally {
      setBusy(false);
    }
  }, [draft, isAdministrator, loaded, locale, storefrontPublicId, tenantId]);

  const resetToDefault = useCallback(async () => {
    if (!loaded) {
      return;
    }

    if (!isAdministrator) {
      setError(storefrontsCopy(locale, "adminRequiredResetTheme"));
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
        throw new Error(payload.error ?? storefrontsCopy(locale, "unableToResetTheme"));
      }

      const saved = payload.themeDraft!;
      setLoaded({
        ...loaded,
        draftVersion: saved.draftVersion,
        theme: saved.theme,
      });
      setDraft(cloneTheme(saved.theme));
      setMessage(storefrontsCopy(locale, "themeReset"));
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : storefrontsCopy(locale, "unableToResetTheme"),
      );
    } finally {
      setBusy(false);
    }
  }, [isAdministrator, loaded, locale, storefrontPublicId, tenantId]);

  const titleId = `storefront-theme-${storefrontPublicId}`;

  if (!loaded || !draft) {
    return (
      <PortalPanel>
        <h2 className="qosp-panel-title">{copy("themeTitle")}</h2>
        {error ? (
          <div className="qosp-panel-body">
            <PortalNotice tone="error">{error}</PortalNotice>
          </div>
        ) : (
          <p className="qosp-panel-help" role="status">
            {copy("themeLoading")}
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
            {copy("themeTitle")}
          </h2>
          <p className="qosp-panel-help">
            {copy("themeHelp", { version: loaded.draftVersion })}
          </p>
        </div>
        <div className="qosp-button-row">
          <button
            type="button"
            disabled={busy || !isDirty}
            onClick={() => setDraft(cloneTheme(loaded.theme))}
            className="qos-btn"
            data-variant="secondary"
          >
            {staffUiCopy(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !isAdministrator}
            onClick={() => void resetToDefault()}
            className="qos-btn"
            data-variant="secondary"
          >
            {copy("resetToDefault")}
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

      {isDirty ? <PortalNotice tone="warning">{copy("themeUnsaved")}</PortalNotice> : null}
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

      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("presetLabel")}>
          <select
            className="qos-select"
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
            <option value="hospitality_baseline">{copy("presetHospitality")}</option>
            <option value="generic_retail_baseline">{copy("presetRetail")}</option>
          </select>
        </PortalField>

        <PortalField label={copy("logoLabel")} help={copy("logoHelp")}>
          <input
            className="qos-input"
            dir="ltr"
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
        </PortalField>
      </div>

      <fieldset className="qosp-sf-colors">
        <legend className="qosp-field-label">{copy("colorsLabel")}</legend>
        <div className="qosp-sf-color-grid">
          {COLOR_TOKENS.map(({ token, key }) => (
            <label key={token} className="qosp-sf-color">
              <input
                type="color"
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
              <span className="qosp-sf-color-text">
                <span className="qosp-field-label">{copy(key)}</span>
                <span className="qosp-meta-line" dir="ltr">
                  {draft.colors[token]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="qosp-form-grid" data-columns="2">
        <PortalField label={copy("bodyFont")}>
          <select
            className="qos-select"
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
            <option value="system-ui">{copy("fontSystem")}</option>
          </select>
        </PortalField>

        <PortalField label={copy("displayFont")}>
          <select
            className="qos-select"
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
            <option value="system-ui">{copy("fontSystem")}</option>
          </select>
        </PortalField>
      </div>
    </section>
  );
}
