"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type Review = {
  runPublicId: string;
  status: string;
  suggestionState: "pending" | "accepted" | "rejected" | "stale" | "failed";
  failureMessage: string | null;
  sourceLocale: "en" | "ar";
  targetLocale: "en" | "ar";
  source: { displayName: string; description: string | null };
  suggestion: { displayName: string; description: string | null } | null;
  editableSuggestion: { displayName: string; description: string | null } | null;
  targetTranslationVersion: number;
  gateReady: boolean;
  gateReason: string | null;
};

type AiTranslationReviewProps = {
  tenantId: string;
  productPublicId: string;
  uiLocale: "en" | "ar";
};

const COPY = {
  en: {
    title: "AI translation review",
    subtitle: "Compare the source with the suggestion, edit if needed, then accept or reject.",
    requestEnToAr: "Translate EN → AR",
    requestArToEn: "Translate AR → EN",
    source: "Source",
    suggestion: "Suggestion",
    displayName: "Display name",
    description: "Description",
    accept: "Accept",
    reject: "Reject",
    stale: "This suggestion is out of date. Request a new translation.",
    failed: "Translation failed.",
    notConfigured: "AI translation is not configured for this environment.",
    pending: "Translation in progress…",
    accepted: "Accepted into draft (pending administrator approval).",
    rejected: "Rejected. Product text was not changed.",
    none: "No translation review yet.",
  },
  ar: {
    title: "مراجعة الترجمة بالذكاء الاصطناعي",
    subtitle: "قارن المصدر مع الاقتراح، عدّل إن لزم، ثم قبول أو رفض.",
    requestEnToAr: "ترجمة EN → AR",
    requestArToEn: "ترجمة AR → EN",
    source: "المصدر",
    suggestion: "الاقتراح",
    displayName: "اسم العرض",
    description: "الوصف",
    accept: "قبول",
    reject: "رفض",
    stale: "هذا الاقتراح قديم. اطلب ترجمة جديدة.",
    failed: "فشلت الترجمة.",
    notConfigured: "الترجمة بالذكاء الاصطناعي غير مهيأة في هذه البيئة.",
    pending: "الترجمة قيد التنفيذ…",
    accepted: "تم القبول في المسودة (بانتظار موافقة المسؤول).",
    rejected: "مرفوض. لم يتغير نص المنتج.",
    none: "لا توجد مراجعة ترجمة بعد.",
  },
} as const;

function newIdempotencyKey() {
  return `idem-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function localeLabel(locale: "en" | "ar") {
  return locale === "en" ? "English" : "العربية";
}

export function AiTranslationReview({
  tenantId,
  productPublicId,
  uiLocale,
}: AiTranslationReviewProps) {
  const t = COPY[uiLocale];
  const base = `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/translations/ai`;

  const [review, setReview] = useState<Review | null>(null);
  const [gateReady, setGateReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");

  const loadReview = useCallback(async () => {
    const response = await staffApiFetch(`${base}/review`);
    const payload = (await response.json()) as {
      review?: Review | null;
      gateReady?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load translation review.");
    }
    setReview(payload.review ?? null);
    setGateReady(payload.gateReady ?? false);
    const editable = payload.review?.editableSuggestion ?? payload.review?.suggestion;
    if (editable) {
      setDisplayName(editable.displayName);
      setDescription(editable.description ?? "");
    }
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReview().catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load translation review.",
        );
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReview]);

  useEffect(() => {
    if (!review || review.status === "completed" || review.status === "failed") {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadReview().catch(() => undefined);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [loadReview, review]);

  const canEdit = useMemo(
    () =>
      review &&
      review.suggestionState !== "accepted" &&
      review.suggestionState !== "rejected" &&
      review.suggestionState !== "stale" &&
      review.status === "completed" &&
      review.suggestion,
    [review],
  );

  async function requestTranslation(sourceLocale: "en" | "ar", targetLocale: "en" | "ar") {
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/request`, {
        method: "POST",
        body: JSON.stringify({
          sourceLocale,
          targetLocale,
          idempotencyKey: newIdempotencyKey(),
        }),
      });
      const payload = (await response.json()) as { review?: Review; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to request translation.");
      }
      setReview(payload.review ?? null);
      const editable = payload.review?.editableSuggestion ?? payload.review?.suggestion;
      if (editable) {
        setDisplayName(editable.displayName);
        setDescription(editable.description ?? "");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to request translation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!review) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/accept`, {
        method: "POST",
        body: JSON.stringify({
          runPublicId: review.runPublicId,
          displayName,
          description: description.trim() ? description.trim() : null,
          expectedTargetTranslationVersion: review.targetTranslationVersion,
        }),
      });
      const payload = (await response.json()) as { review?: Review; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to accept translation.");
      }
      setReview(payload.review ?? null);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept translation.");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!review) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/reject`, {
        method: "POST",
        body: JSON.stringify({ runPublicId: review.runPublicId }),
      });
      const payload = (await response.json()) as { review?: Review; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reject translation.");
      }
      setReview(payload.review ?? null);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Unable to reject translation.");
    } finally {
      setBusy(false);
    }
  }

  const sourceDir = review?.sourceLocale === "ar" ? "rtl" : "ltr";
  const targetDir = review?.targetLocale === "ar" ? "rtl" : "ltr";

  return (
    <section className="space-y-4" aria-labelledby="ai-translation-review-title">
      <header>
        <h2 id="ai-translation-review-title" className="text-lg font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-zinc-600">{t.subtitle}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
          disabled={busy || !gateReady}
          onClick={() => void requestTranslation("en", "ar")}
        >
          {t.requestEnToAr}
        </button>
        <button
          type="button"
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
          disabled={busy || !gateReady}
          onClick={() => void requestTranslation("ar", "en")}
        >
          {t.requestArToEn}
        </button>
      </div>

      {!gateReady ? (
        <p className="qos-alert" data-tone="warning" role="status">
          {t.notConfigured}
        </p>
      ) : null}

      {error ? (
        <p className="qos-alert" data-tone="error" role="alert">
          {error}
        </p>
      ) : null}

      {review?.suggestionState === "stale" ? (
        <p className="qos-alert" data-tone="warning" role="status">{t.stale}</p>
      ) : null}
      {review?.suggestionState === "failed" ? (
        <p className="qos-alert" data-tone="error" role="alert">
          {review.failureMessage ?? t.failed}
        </p>
      ) : null}
      {review?.suggestionState === "accepted" ? (
        <p className="text-sm text-zinc-600" role="status">{t.accepted}</p>
      ) : null}
      {review?.suggestionState === "rejected" ? (
        <p className="text-sm text-zinc-600" role="status">{t.rejected}</p>
      ) : null}
      {review && review.status !== "completed" && review.suggestionState === "pending" ? (
        <p className="text-sm text-zinc-600" role="status">{t.pending}</p>
      ) : null}
      {!review ? <p className="text-sm text-zinc-500">{t.none}</p> : null}

      {review ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <article className="qos-card" data-padding="md" dir={sourceDir} lang={review.sourceLocale}>
            <h3 className="mb-3 text-sm font-medium text-zinc-700">
              {t.source} ({localeLabel(review.sourceLocale)})
            </h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-medium text-zinc-600">{t.displayName}</dt>
                <dd>{review.source.displayName}</dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-600">{t.description}</dt>
                <dd>{review.source.description ?? "—"}</dd>
              </div>
            </dl>
          </article>

          <article className="qos-card" data-padding="md" dir={targetDir} lang={review.targetLocale}>
            <h3 className="mb-3 text-sm font-medium text-zinc-700">
              {t.suggestion} ({localeLabel(review.targetLocale)})
            </h3>
            {canEdit ? (
              <div className="space-y-3 text-sm">
                <label className="block">
                  <span className="font-medium text-zinc-600">{t.displayName}</span>
                  <input
                    className="qos-input mt-1 w-full"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    dir={targetDir}
                  />
                </label>
                <label className="block">
                  <span className="font-medium text-zinc-600">{t.description}</span>
                  <textarea
                    className="qos-input mt-1 w-full min-h-[96px]"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    dir={targetDir}
                  />
                </label>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="primary"
                    data-size="sm"
                    disabled={busy}
                    onClick={() => void accept()}
                  >
                    {t.accept}
                  </button>
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    disabled={busy}
                    onClick={() => void reject()}
                  >
                    {t.reject}
                  </button>
                </div>
              </div>
            ) : review.editableSuggestion || review.suggestion ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-medium text-zinc-600">{t.displayName}</dt>
                  <dd>{(review.editableSuggestion ?? review.suggestion)?.displayName}</dd>
                </div>
                <div>
                  <dt className="font-medium text-zinc-600">{t.description}</dt>
                  <dd>{(review.editableSuggestion ?? review.suggestion)?.description ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-zinc-500">—</p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
