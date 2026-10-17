"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import {
  translationApprovalsCopy,
  type TranslationApprovalsLocale,
} from "@/lib/catalogue/translation-approvals-ui-copy";

type PendingItem = {
  productPublicId: string;
  productInternalName: string;
  locale: "en" | "ar";
  translationVersion: number;
  sourceTranslationVersion: number | null;
  proposed: {
    displayName: string;
    description: string | null;
  };
  sourceCopy: {
    locale: "en";
    displayName: string;
    description: string | null;
    translationVersion: number;
  } | null;
  lastApproved: {
    translationVersion: number | null;
    approvedAt: string | null;
    approvedBySubject: string | null;
  };
  acceptedBySubject: string | null;
  acceptedAt: string | null;
  updatedAt: string;
};

type TranslationApprovalsReviewProps = {
  tenantId: string;
};

function formatWhen(value: string | null, locale: TranslationApprovalsLocale) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString(locale === "ar" ? "ar" : "en");
}

function localeLabel(locale: "en" | "ar", uiLocale: TranslationApprovalsLocale) {
  if (uiLocale === "ar") {
    return locale === "en" ? "الإنجليزية" : "العربية";
  }

  return locale === "en" ? "English" : "Arabic";
}

export function TranslationApprovalsReview({ tenantId }: TranslationApprovalsReviewProps) {
  const { locale: uiLocale } = useStaffLocale();
  const t = translationApprovalsCopy(uiLocale);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setError(null);
    setForbidden(false);

    const response = await staffApiFetch(
      `/api/tenants/${tenantId}/catalogue/translation-approvals`,
    );
    const payload = (await response.json()) as {
      items?: PendingItem[];
      error?: string;
    };

    if (response.status === 403) {
      setForbidden(true);
      return;
    }

    if (!response.ok) {
      throw new Error(payload.error ?? t.loadError);
    }

    setItems(payload.items ?? []);
    setLoaded(true);
  }, [tenantId, t.loadError]);

  async function refreshList() {
    setLoading(true);
    setError(null);
    try {
      await loadItems();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }

  async function mutate(
    item: PendingItem,
    action: "approve" | "reject",
  ) {
    const key = `${item.productPublicId}:${item.locale}`;
    setBusyKey(key);
    setError(null);

    try {
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${item.productPublicId}/translations/${item.locale}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedTranslationVersion: item.translationVersion,
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (response.status === 409) {
        throw new Error(t.staleConflict);
      }
      if (!response.ok) {
        throw new Error(payload.error ?? t.actionError);
      }

      await loadItems();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : t.actionError,
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (forbidden) {
    return (
      <div className="qos-alert" data-tone="warning" role="status">
        <div>
          <div className="qos-alert-title">{t.adminOnlyTitle}</div>
          <div className="qos-alert-body">{t.adminOnlyBody}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="qos-card-sub">{t.intro}</p>
        <button
          type="button"
          className="qos-btn"
          data-variant={loaded ? "secondary" : "primary"}
          data-size="sm"
          disabled={loading}
          onClick={() => {
            void refreshList();
          }}
        >
          {loading ? t.loading : loaded ? t.refresh : t.loadQueue}
        </button>
      </div>

      {error ? (
        <p className="qos-alert" data-tone="error" role="alert">
          {error}
        </p>
      ) : null}

      {!loaded ? null : items.length === 0 ? (
        <div className="qos-card" data-padding="md">
          <p className="qos-empty-body">{t.empty}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const key = `${item.productPublicId}:${item.locale}`;
            const busy = busyKey === key;
            const dir = item.locale === "ar" ? "rtl" : "ltr";

            return (
              <li key={key} className="qos-card" data-padding="md">
                <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="qos-card-sub">{item.productInternalName}</p>
                    <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                      {localeLabel(item.locale, uiLocale)}
                    </h2>
                    <p className="qos-card-sub">
                      {t.sourceRevision}: {item.sourceTranslationVersion ?? "—"} ·{" "}
                      {t.pendingRevision}: {item.translationVersion}
                    </p>
                  </div>
                  <Link
                    href={`/tenants/${tenantId}/catalogue/products/${item.productPublicId}/translations`}
                    className="text-sm font-medium"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t.openProduct}
                  </Link>
                </header>

                <div className="grid gap-4 lg:grid-cols-2">
                  {item.sourceCopy ? (
                    <article lang="en" dir="ltr">
                      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {t.englishSource}
                      </h3>
                      <p className="qos-card-sub">
                        {t.version} {item.sourceCopy.translationVersion}
                      </p>
                      <dl className="mt-2 space-y-2 text-sm">
                        <div>
                          <dt style={{ color: "var(--text-secondary)" }}>{t.displayName}</dt>
                          <dd style={{ color: "var(--text-primary)" }}>
                            {item.sourceCopy.displayName}
                          </dd>
                        </div>
                        <div>
                          <dt style={{ color: "var(--text-secondary)" }}>{t.description}</dt>
                          <dd style={{ color: "var(--text-primary)" }}>
                            {item.sourceCopy.description ?? "—"}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ) : null}

                  <article lang={item.locale} dir={dir}>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {t.proposedCopy}
                    </h3>
                    {item.lastApproved.translationVersion != null ? (
                      <p className="qos-card-sub">
                        {t.lastApprovedVersion} {item.lastApproved.translationVersion}
                      </p>
                    ) : null}
                    <dl className="mt-2 space-y-2 text-sm">
                      <div>
                        <dt style={{ color: "var(--text-secondary)" }}>{t.displayName}</dt>
                          <dd style={{ color: "var(--text-primary)" }} dir="auto">
                            <bdi>{item.proposed.displayName}</bdi>
                          </dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--text-secondary)" }}>{t.description}</dt>
                          <dd style={{ color: "var(--text-primary)" }} dir="auto">
                            <bdi>{item.proposed.description ?? "—"}</bdi>
                          </dd>
                      </div>
                    </dl>
                  </article>
                </div>

                <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
                  <p className="qos-card-sub">
                    {t.acceptedBy} {item.acceptedBySubject ?? "—"} · {t.acceptedAt}{" "}
                    {formatWhen(item.acceptedAt, uiLocale)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="primary"
                      data-size="sm"
                      disabled={busy}
                      onClick={() => void mutate(item, "approve")}
                    >
                      {t.approve}
                    </button>
                    <button
                      type="button"
                      className="qos-btn"
                      data-variant="secondary"
                      data-size="sm"
                      disabled={busy}
                      onClick={() => void mutate(item, "reject")}
                    >
                      {t.reject}
                    </button>
                  </div>
                </footer>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
