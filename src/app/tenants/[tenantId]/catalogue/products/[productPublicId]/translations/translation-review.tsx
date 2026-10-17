"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type TranslationReviewView = {
  locale: "en" | "ar";
  displayName: string;
  description: string | null;
  translationVersion: number;
  approvalStatus: "draft" | "approved" | "rejected";
  provenance: string;
  approvedBySubject: string | null;
  approvedAt: string | null;
  approvedTranslationVersion: number | null;
  approvedSourceTranslationVersion: number | null;
  lastApprovedBySubject: string | null;
  lastApprovedAt: string | null;
  lastApprovedTranslationVersion: number | null;
  lastApprovedSourceTranslationVersion: number | null;
};

type ReviewBundle = {
  productPublicId: string;
  internalName: string;
  sourceLocale: "en";
  translations: Record<"en" | "ar", TranslationReviewView>;
};

type TranslationReviewProps = {
  tenantId: string;
  productPublicId: string;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function statusLabel(status: "draft" | "approved" | "rejected") {
  if (status === "approved") {
    return "Approved";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  return "Draft";
}

export function TranslationReview({
  tenantId,
  productPublicId,
}: TranslationReviewProps) {
  const [review, setReview] = useState<ReviewBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLocale, setBusyLocale] = useState<"en" | "ar" | null>(null);

  const loadReview = useCallback(async () => {
    setError(null);

    const response = await staffApiFetch(
      `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/translations/review`,
    );

    const payload = (await response.json()) as {
      review?: ReviewBundle;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load translation review.");
    }

    setReview(payload.review ?? null);
  }, [productPublicId, tenantId]);

  async function mutateTranslation(
    locale: "en" | "ar",
    action: "approve" | "reject",
  ) {
    if (!review) {
      return;
    }

    setBusyLocale(locale);
    setError(null);

    try {
      const translation = review.translations[locale];
      const response = await staffApiFetch(
        `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/translations/${locale}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedTranslationVersion: translation.translationVersion,
          }),
        },
      );

      const payload = (await response.json()) as {
        review?: ReviewBundle;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? `Unable to ${action} translation.`);
      }

      setReview(payload.review ?? null);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : `Unable to ${action} translation.`,
      );
    } finally {
      setBusyLocale(null);
    }
  }

  const english = review?.translations.en;
  const arabic = review?.translations.ar;

  return (
    <div className="space-y-8">
      <section className="qos-card" data-padding="sm">
        <button
          type="button"
          onClick={() => {
            void loadReview().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load translation review.",
              );
            });
          }}
          className="qos-btn" data-variant="primary"
        >
          Load review
        </button>
      </section>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {review ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Internal name
              </p>
              <p className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>
                {review.internalName}
              </p>
            </div>
            <Link
              href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/edit`}
              className="text-sm font-medium underline-offset-4 hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Back to product editor
            </Link>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <article className="qos-card" data-padding="md">
              <header className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Source
                  </p>
                  <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    English
                  </h3>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: "var(--surface-muted, rgba(255,255,255,0.08))",
                    color: "var(--text-primary)",
                  }}
                >
                  {english ? statusLabel(english.approvalStatus) : "—"}
                </span>
              </header>
              {english ? (
                <div className="space-y-3 text-sm" style={{ color: "var(--text-primary)" }}>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Display name:
                    </span>{" "}
                    {english.displayName}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Description:
                    </span>{" "}
                    {english.description ?? "—"}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Version:
                    </span>{" "}
                    {english.translationVersion}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Provenance:
                    </span>{" "}
                    {english.provenance}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Approved by:
                    </span>{" "}
                    {english.approvedBySubject ?? "—"}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Approved at:
                    </span>{" "}
                    {formatTimestamp(english.approvedAt)}
                  </p>
                  {english.lastApprovedAt ? (
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                      Last approved v{english.lastApprovedTranslationVersion} by{" "}
                      {english.lastApprovedBySubject} on{" "}
                      {formatTimestamp(english.lastApprovedAt)}
                    </p>
                  ) : null}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      disabled={busyLocale === "en"}
                      onClick={() => void mutateTranslation("en", "approve")}
                      className="qos-btn" data-variant="primary" data-size="sm"
                    >
                      Approve EN
                    </button>
                    <button
                      type="button"
                      disabled={busyLocale === "en"}
                      onClick={() => void mutateTranslation("en", "reject")}
                      className="qos-btn" data-variant="secondary" data-size="sm"
                    >
                      Reject EN
                    </button>
                  </div>
                </div>
              ) : null}
            </article>

            <article
              className="qos-card" data-padding="md"
              dir="rtl"
              lang="ar"
            >
              <header className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Translation
                  </p>
                  <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    العربية
                  </h3>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: "var(--surface-muted, rgba(255,255,255,0.08))",
                    color: "var(--text-primary)",
                  }}
                >
                  {arabic ? statusLabel(arabic.approvalStatus) : "—"}
                </span>
              </header>
              {arabic ? (
                <div className="space-y-3 text-sm" style={{ color: "var(--text-primary)" }}>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Display name:
                    </span>{" "}
                    {arabic.displayName}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Description:
                    </span>{" "}
                    {arabic.description ?? "—"}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Version:
                    </span>{" "}
                    {arabic.translationVersion}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Provenance:
                    </span>{" "}
                    {arabic.provenance}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Source EN version:
                    </span>{" "}
                    {arabic.approvedSourceTranslationVersion ?? "—"}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Approved by:
                    </span>{" "}
                    {arabic.approvedBySubject ?? "—"}
                  </p>
                  <p>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      Approved at:
                    </span>{" "}
                    {formatTimestamp(arabic.approvedAt)}
                  </p>
                  {arabic.lastApprovedAt ? (
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                      Last approved v{arabic.lastApprovedTranslationVersion} (EN v
                      {arabic.lastApprovedSourceTranslationVersion}) by{" "}
                      {arabic.lastApprovedBySubject} on{" "}
                      {formatTimestamp(arabic.lastApprovedAt)}
                    </p>
                  ) : null}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      disabled={busyLocale === "ar"}
                      onClick={() => void mutateTranslation("ar", "approve")}
                      className="qos-btn" data-variant="primary" data-size="sm"
                    >
                      Approve AR
                    </button>
                    <button
                      type="button"
                      disabled={busyLocale === "ar"}
                      onClick={() => void mutateTranslation("ar", "reject")}
                      className="qos-btn" data-variant="secondary" data-size="sm"
                    >
                      Reject AR
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          </div>
        </>
      ) : null}
    </div>
  );
}
