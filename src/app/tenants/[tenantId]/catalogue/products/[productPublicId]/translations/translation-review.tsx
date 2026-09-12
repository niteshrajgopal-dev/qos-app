"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type TranslationReviewView = {
  locale: "en" | "ar";
  displayName: string;
  description: string | null;
  translationVersion: number;
  approvalStatus: "draft" | "approved";
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

function statusLabel(status: "draft" | "approved") {
  return status === "approved" ? "Approved" : "Draft";
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
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm text-zinc-600">
          Sign in at{" "}
          <Link href="/staff/sign-in" className="font-medium text-zinc-900 underline">
            staff sign-in
          </Link>{" "}
          before reviewing translations.
        </p>
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
          className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Load review
        </button>
      </section>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {review ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-500">Internal name</p>
              <p className="text-lg font-medium">{review.internalName}</p>
            </div>
            <Link
              href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/edit`}
              className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline"
            >
              Back to product editor
            </Link>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <article className="rounded-xl border border-zinc-200 p-5">
              <header className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Source
                  </p>
                  <h3 className="text-lg font-semibold">English</h3>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                  {english ? statusLabel(english.approvalStatus) : "—"}
                </span>
              </header>
              {english ? (
                <div className="space-y-3 text-sm">
                  <p>
                    <span className="font-medium text-zinc-700">Display name:</span>{" "}
                    {english.displayName}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Description:</span>{" "}
                    {english.description ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Version:</span>{" "}
                    {english.translationVersion}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Provenance:</span>{" "}
                    {english.provenance}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Approved by:</span>{" "}
                    {english.approvedBySubject ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Approved at:</span>{" "}
                    {formatTimestamp(english.approvedAt)}
                  </p>
                  {english.lastApprovedAt ? (
                    <p className="text-zinc-500">
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
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Approve EN
                    </button>
                    <button
                      type="button"
                      disabled={busyLocale === "en"}
                      onClick={() => void mutateTranslation("en", "reject")}
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
                    >
                      Reject EN
                    </button>
                  </div>
                </div>
              ) : null}
            </article>

            <article
              className="rounded-xl border border-zinc-200 p-5"
              dir="rtl"
              lang="ar"
            >
              <header className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Translation
                  </p>
                  <h3 className="text-lg font-semibold">العربية</h3>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                  {arabic ? statusLabel(arabic.approvalStatus) : "—"}
                </span>
              </header>
              {arabic ? (
                <div className="space-y-3 text-sm">
                  <p>
                    <span className="font-medium text-zinc-700">Display name:</span>{" "}
                    {arabic.displayName}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Description:</span>{" "}
                    {arabic.description ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Version:</span>{" "}
                    {arabic.translationVersion}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Provenance:</span>{" "}
                    {arabic.provenance}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Source EN version:</span>{" "}
                    {arabic.approvedSourceTranslationVersion ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Approved by:</span>{" "}
                    {arabic.approvedBySubject ?? "—"}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-700">Approved at:</span>{" "}
                    {formatTimestamp(arabic.approvedAt)}
                  </p>
                  {arabic.lastApprovedAt ? (
                    <p className="text-zinc-500">
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
                      className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Approve AR
                    </button>
                    <button
                      type="button"
                      disabled={busyLocale === "ar"}
                      onClick={() => void mutateTranslation("ar", "reject")}
                      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50"
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
