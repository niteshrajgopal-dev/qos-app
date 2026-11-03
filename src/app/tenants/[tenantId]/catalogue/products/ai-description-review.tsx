"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PortalNotice } from "@/components/portal/workspace/PortalWorkspace";
import { AI_DESCRIPTION_REVIEW_ACCEPTED_COPY } from "@/lib/catalogue/ai-description-review-copy";
import { shouldShowDescriptionAcceptedBanner } from "@/lib/catalogue/ai-description-review-ui";
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
  mutationsDisabled?: boolean;
  /** Called after accept succeeds so the editor can refetch draft product state from the API. */
  onAccepted?: () => void;
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
    accepted: AI_DESCRIPTION_REVIEW_ACCEPTED_COPY.en,
    rejected: "Rejected. The description was not changed.",
    none: "No description review yet.",
    mock: "Mock result (development only).",
    timeout: "The request timed out. Try again.",
    loadError: "Unable to load description review.",
    requestError: "Unable to request description help.",
    acceptError: "Unable to accept description.",
    rejectError: "Unable to reject description.",
  },
  ar: {
    title: "مسودة وصف بالذكاء الاصطناعي",
    subtitle: "اطلب اقتراحًا للوصف بالإنجليزية، وراجع الفروقات، ثم اقبله أو ارفضه.",
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
    accepted: AI_DESCRIPTION_REVIEW_ACCEPTED_COPY.ar,
    rejected: "مرفوض. لم يتغير الوصف.",
    none: "لا توجد مراجعة للوصف بعد.",
    mock: "نتيجة تجريبية (للتطوير فقط).",
    timeout: "انتهت مهلة الطلب. حاول مرة أخرى.",
    loadError: "تعذّر تحميل مراجعة الوصف.",
    requestError: "تعذّر طلب المساعدة في الوصف.",
    acceptError: "تعذّر قبول الوصف.",
    rejectError: "تعذّر رفض الوصف.",
  },
} as const;

function newIdempotencyKey() {
  return `idem-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function AiDescriptionReview({
  tenantId,
  productPublicId,
  uiLocale,
  mutationsDisabled = false,
  onAccepted,
}: AiDescriptionReviewProps) {
  const t = COPY[uiLocale];
  const base = `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/description/ai`;

  const [review, setReview] = useState<Review | null>(null);
  const [gateReady, setGateReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [acceptedThisSession, setAcceptedThisSession] = useState(false);

  const loadReview = useCallback(async () => {
    const response = await staffApiFetch(`${base}/review`);
    const payload = (await response.json()) as {
      review?: Review | null;
      gateReady?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? t.loadError);
    }
    setReview(payload.review ?? null);
    setAcceptedThisSession(false);
    setGateReady(payload.gateReady ?? false);
    const editable = payload.review?.editableSuggestion ?? payload.review?.suggestion;
    if (editable !== undefined && editable !== null) {
      setDescription(editable);
    } else if (payload.review?.suggestion === null && payload.review?.editableSuggestion === null) {
      setDescription("");
    }
  }, [base, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReview().catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : t.loadError,
        );
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReview, t]);

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
        const message = payload.error ?? t.requestError;
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
        requestError instanceof Error ? requestError.message : t.requestError,
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
        throw new Error(payload.error ?? t.acceptError);
      }
      setReview(payload.review ?? null);
      if (payload.review?.suggestionState === "accepted") {
        setAcceptedThisSession(true);
        onAccepted?.();
      }
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : t.acceptError);
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
        throw new Error(payload.error ?? t.rejectError);
      }
      setReview(payload.review ?? null);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : t.rejectError);
    } finally {
      setBusy(false);
    }
  }

  const showQuotaWarning =
    !gateReady && review?.gateReason === "spend_policy_unset" ? false : !gateReady;

  return (
    <section
      className="qosp-subcard qosp-stack"
      dir={uiLocale === "ar" ? "rtl" : "ltr"}
      lang={uiLocale}
    >
      <header>
        <h3 className="qosp-subcard-title">{t.title}</h3>
        <p className="qosp-panel-help">{t.subtitle}</p>
      </header>

      <div className="qosp-button-row">
        <button
          type="button"
          className="qos-btn"
          data-variant="secondary"
          data-size="sm"
          disabled={busy || !gateReady || mutationsDisabled}
          onClick={() => void requestDescription()}
        >
          {t.request}
        </button>
      </div>

      {showQuotaWarning ? <PortalNotice tone="warning">{t.notConfigured}</PortalNotice> : null}
      {review?.isMockResult ? <PortalNotice tone="warning">{t.mock}</PortalNotice> : null}
      {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}
      {review?.failureCode === "qos_wait_deadline" || review?.failureCode === "timeout" ? (
        <PortalNotice tone="warning">{t.timeout}</PortalNotice>
      ) : null}
      {review?.suggestionState === "stale" ? (
        <PortalNotice tone="warning">{t.stale}</PortalNotice>
      ) : null}
      {review?.suggestionState === "failed" ? (
        <PortalNotice tone="error">{review.failureMessage ?? t.failed}</PortalNotice>
      ) : null}
      {shouldShowDescriptionAcceptedBanner(review?.suggestionState, acceptedThisSession) ? (
        <p className="qosp-meta-line" role="status">{t.accepted}</p>
      ) : null}
      {review?.suggestionState === "rejected" ? (
        <p className="qosp-meta-line" role="status">{t.rejected}</p>
      ) : null}
      {review && review.status !== "completed" && review.suggestionState === "pending" ? (
        <p className="qosp-meta-line" role="status">{t.pending}</p>
      ) : null}
      {!review ? <p className="qosp-meta-line">{t.none}</p> : null}

      {review ? (
        <div className="qosp-form-grid" data-columns="2">
          <article className="qosp-subcard" dir="ltr" lang="en">
            <h4 className="qosp-field-label">{t.source}</h4>
            <p className="qosp-prewrap">{review.sourceDescription ?? "—"}</p>
          </article>

          <article className="qosp-subcard" dir="ltr" lang="en">
            <h4 className="qosp-field-label">{t.suggestion}</h4>
            {canEdit ? (
              <div className="qosp-stack">
                <textarea
                  className="qos-textarea"
                  rows={4}
                  aria-label={t.suggestion}
                  value={description}
                  disabled={mutationsDisabled}
                  onChange={(event) => setDescription(event.target.value)}
                  dir="ltr"
                />
                <div className="qosp-button-row">
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="primary"
                    data-size="sm"
                    disabled={busy || mutationsDisabled}
                    onClick={() => void accept()}
                  >
                    {t.accept}
                  </button>
                  <button
                    type="button"
                    className="qos-btn"
                    data-variant="secondary"
                    data-size="sm"
                    disabled={busy || mutationsDisabled}
                    onClick={() => void reject()}
                  >
                    {t.reject}
                  </button>
                </div>
              </div>
            ) : (
              <p className="qosp-prewrap">
                {review.editableSuggestion ?? review.suggestion ?? "—"}
              </p>
            )}
          </article>

          {review.descriptionDiff.length > 0 ? (
            <article className="qosp-subcard qosp-span-full" dir="ltr" lang="en">
              <h4 className="qosp-field-label">{t.diff}</h4>
              <ul className="qosp-diff">
                {review.descriptionDiff.map((line, index) => (
                  <li key={`${line.kind}-${index}`} data-kind={line.kind}>
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
