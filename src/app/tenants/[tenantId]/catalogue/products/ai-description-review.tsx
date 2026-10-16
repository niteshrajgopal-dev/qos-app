"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type DiffLine = {
  kind: "unchanged" | "removed" | "added";
  text: string;
};

type Review = {
  runPublicId: string;
  status: string;
  suggestionState: "pending" | "accepted" | "rejected" | "stale" | "failed";
  failureCode: string | null;
  failureMessage: string | null;
  sourceDescription: string | null;
  suggestion: string | null;
  editableSuggestion: string | null;
  descriptionDiff: DiffLine[];
  sourceTranslationVersion: number;
  gateReady: boolean;
  gateReason: string | null;
  isMockResult: boolean;
};

type AiDescriptionReviewProps = {
  tenantId: string;
  productPublicId: string;
  uiLocale: "en" | "ar";
  onAccepted?: (description: string | null, translationVersion: number) => void;
};

const COPY = {
  en: {
    title: "AI description draft",
    subtitle: "Request an English description suggestion, review the diff, then accept or reject.",
    request: "Improve description",
    source: "Current description",
    suggestion: "Suggested description",
    diff: "Diff",
    accept: "Accept",
    reject: "Reject",
    stale: "This suggestion is out of date. Request a new description.",
    failed: "Description help failed.",
    notConfigured: "AI description help is not configured for this environment.",
    quotaExceeded: "AI description quota is exhausted. Try again later.",
    pending: "Description suggestion in progress…",
    accepted: "Accepted into the product draft (not published).",
    rejected: "Rejected. The description was not changed.",
    none: "No description review yet.",
    mock: "Mock result (development only).",
    timeout: "The request timed out. Try again.",
  },
  ar: {
    title: "مسودة وصف بالذكاء الاصطناعي",
    subtitle: "اطلب اقتراحًا للوصف بالإنجليزية، راجع الفروقات، ثم قبول أو رفض.",
    request: "تحسين الوصف",
    source: "الوصف الحالي",
    suggestion: "الوصف المقترح",
    diff: "الفروقات",
    accept: "قبول",
    reject: "رفض",
    stale: "هذا الاقتراح قديم. اطلب وصفًا جديدًا.",
    failed: "فشل اقتراح الوصف.",
    notConfigured: "مساعدة الوصف بالذكاء الاصطناعي غير مهيأة في هذه البيئة.",
    quotaExceeded: "تم استنفاد حصة الوصف بالذكاء الاصطناعي. حاول لاحقًا.",
    pending: "اقتراح الوصف قيد التنفيذ…",
    accepted: "تم القبول في مسودة المنتج (لم يُنشر).",
    rejected: "مرفوض. لم يتغير الوصف.",
    none: "لا توجد مراجعة للوصف بعد.",
    mock: "نتيجة تجريبية (للتطوير فقط).",
    timeout: "انتهت مهلة الطلب. حاول مرة أخرى.",
  },
} as const;

function newIdempotencyKey() {
  return `idem-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function AiDescriptionReview({
  tenantId,
  productPublicId,
  uiLocale,
  onAccepted,
}: AiDescriptionReviewProps) {
  const t = COPY[uiLocale];
  const base = `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/description/ai`;

  const [review, setReview] = useState<Review | null>(null);
  const [gateReady, setGateReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");

  const loadReview = useCallback(async () => {
    const response = await staffApiFetch(`${base}/review`);
    const payload = (await response.json()) as {
      review?: Review | null;
      gateReady?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load description review.");
    }
    setReview(payload.review ?? null);
    setGateReady(payload.gateReady ?? false);
    const editable = payload.review?.editableSuggestion ?? payload.review?.suggestion;
    if (editable !== undefined && editable !== null) {
      setDescription(editable);
    } else if (payload.review?.suggestion === null && payload.review?.editableSuggestion === null) {
      setDescription("");
    }
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReview().catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load description review.",
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
      review.suggestion !== null,
    [review],
  );

  async function requestDescription() {
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/request`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: newIdempotencyKey() }),
      });
      const payload = (await response.json()) as { review?: Review; error?: string };
      if (!response.ok) {
        const message = payload.error ?? "Unable to request description help.";
        if (response.status === 503 && message.toLowerCase().includes("spend")) {
          throw new Error(t.quotaExceeded);
        }
        throw new Error(message);
      }
      setReview(payload.review ?? null);
      const editable = payload.review?.editableSuggestion ?? payload.review?.suggestion;
      if (editable) {
        setDescription(editable);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to request description help.",
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
          description: description.trim() ? description.trim() : null,
          expectedSourceTranslationVersion: review.sourceTranslationVersion,
        }),
      });
      const payload = (await response.json()) as { review?: Review; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to accept description.");
      }
      setReview(payload.review ?? null);
      if (payload.review?.suggestionState === "accepted") {
        const nextDescription =
          payload.review.editableSuggestion ??
          (description.trim() ? description.trim() : null);
        onAccepted?.(nextDescription, payload.review.sourceTranslationVersion);
      }
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept description.");
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
        throw new Error(payload.error ?? "Unable to reject description.");
      }
      setReview(payload.review ?? null);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Unable to reject description.");
    } finally {
      setBusy(false);
    }
  }

  const showQuotaWarning =
    !gateReady && review?.gateReason === "spend_policy_unset" ? false : !gateReady;

  return (
    <section className="mt-4 space-y-4 rounded-lg border border-zinc-200 p-4" dir={uiLocale === "ar" ? "rtl" : "ltr"} lang={uiLocale}>
      <header>
        <h3 className="text-sm font-semibold text-zinc-800">{t.title}</h3>
        <p className="text-xs text-zinc-600">{t.subtitle}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
          disabled={busy || !gateReady}
          onClick={() => void requestDescription()}
        >
          {t.request}
        </button>
      </div>

      {showQuotaWarning ? (
        <p className="qos-alert" data-tone="warning" role="status">
          {t.notConfigured}
        </p>
      ) : null}

      {review?.isMockResult ? (
        <p className="text-xs font-medium text-amber-700" role="status">{t.mock}</p>
      ) : null}

      {error ? (
        <p className="qos-alert" data-tone="error" role="alert">
          {error}
        </p>
      ) : null}

      {review?.failureCode === "qos_wait_deadline" || review?.failureCode === "timeout" ? (
        <p className="qos-alert" data-tone="warning" role="status">{t.timeout}</p>
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
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="qos-card" data-padding="sm" dir="ltr" lang="en">
            <h4 className="mb-2 text-xs font-medium text-zinc-700">{t.source}</h4>
            <p className="whitespace-pre-wrap text-sm text-zinc-800">
              {review.sourceDescription ?? "—"}
            </p>
          </article>

          <article className="qos-card" data-padding="sm" dir="ltr" lang="en">
            <h4 className="mb-2 text-xs font-medium text-zinc-700">{t.suggestion}</h4>
            {canEdit ? (
              <div className="space-y-3">
                <textarea
                  className="qos-input min-h-[96px] w-full"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  dir="ltr"
                />
                <div className="flex gap-2">
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
            ) : (
              <p className="whitespace-pre-wrap text-sm text-zinc-800">
                {review.editableSuggestion ?? review.suggestion ?? "—"}
              </p>
            )}
          </article>

          {review.descriptionDiff.length > 0 ? (
            <article className="qos-card lg:col-span-2" data-padding="sm" dir="ltr" lang="en">
              <h4 className="mb-2 text-xs font-medium text-zinc-700">{t.diff}</h4>
              <ul className="space-y-1 font-mono text-xs">
                {review.descriptionDiff.map((line, index) => (
                  <li
                    key={`${line.kind}-${index}`}
                    className={
                      line.kind === "added"
                        ? "bg-emerald-50 text-emerald-900"
                        : line.kind === "removed"
                          ? "bg-rose-50 text-rose-900 line-through"
                          : "text-zinc-700"
                    }
                  >
                    {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
                    {line.text || " "}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
