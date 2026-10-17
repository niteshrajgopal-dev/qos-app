"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MenuExtractionCandidatePayload } from "@/db/schema";
import { menuExtractionFailureMessage } from "@/lib/catalogue/menu-extraction/menu-extraction-failure-copy";
import { menuExtractionConfirmFieldIssues } from "@/lib/catalogue/menu-extraction/candidate-validation";
import { menuExtractionExtractIdempotencyKey } from "@/lib/catalogue/menu-extraction/extract-idempotency";
import { menuExtractionCopy } from "@/lib/catalogue/menu-extraction/menu-extraction-ui-copy";
import { shouldPollMenuExtractionReview } from "@/lib/catalogue/menu-extraction/menu-extraction-review-polling";
import {
  isMenuExtractionReviewClosed,
  menuExtractionRunStatusLabel,
} from "@/lib/catalogue/menu-extraction/menu-extraction-run-status";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type Review = {
  runPublicId: string;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
  sourcePublicId: string;
  pageCount: number;
  gateReady: boolean;
  gateReason: string | null;
  decision: "confirmed" | "rejected" | "cancelled" | null;
  candidatesRevision: number;
  candidates: Array<{
    candidateKey: string;
    excluded: boolean;
    payload: MenuExtractionCandidatePayload;
  }>;
};

type MenuExtractionReviewProps = {
  tenantId: string;
  uiLocale: "en" | "ar";
};

function uncertaintyClass(value: string) {
  if (value === "missing" || value === "contradictory" || value === "high") {
    return "text-amber-800 bg-amber-50";
  }
  if (value === "medium" || value === "low") {
    return "text-slate-700 bg-slate-100";
  }
  return "";
}

export function MenuExtractionReview({ tenantId, uiLocale }: MenuExtractionReviewProps) {
  const t = menuExtractionCopy(uiLocale);
  const dir = uiLocale === "ar" ? "rtl" : "ltr";

  const [sourcePublicId, setSourcePublicId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Review["candidates"]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [extractRetryNonce, setExtractRetryNonce] = useState<string | null>(null);
  const extractKey = useMemo(() => {
    if (!sourcePublicId) {
      return null;
    }
    return menuExtractionExtractIdempotencyKey(sourcePublicId, extractRetryNonce ?? undefined);
  }, [extractRetryNonce, sourcePublicId]);
  const confirmKey = useMemo(() => `confirm-${crypto.randomUUID()}`, []);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const reviewClosed = review ? isMenuExtractionReviewClosed(review.decision) : false;
  const reviewCancelled =
    review?.decision === "cancelled" || review?.decision === "rejected";

  const base = `/api/tenants/${tenantId}/catalogue/menu-extraction`;

  const loadReview = useCallback(
    async (sourceId: string) => {
      const response = await staffApiFetch(`${base}/${sourceId}/review`);
      const payload = (await response.json()) as { review: Review | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? t.gateBlocked);
      }
      if (payload.review) {
        setReview(payload.review);
        setDraft(payload.review.candidates);
      }
    },
    [base, t.gateBlocked],
  );

  useEffect(() => {
    let cancelled = false;
    void staffApiFetch(`${base}/latest-review`)
      .then(async (response) => {
        if (cancelled || !response.ok) {
          return;
        }
        const payload = (await response.json()) as { review: Review | null };
        if (!payload.review) {
          return;
        }
        setSourcePublicId(payload.review.sourcePublicId);
        setReview(payload.review);
        setDraft(payload.review.candidates);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    if (!sourcePublicId || !review || !shouldPollMenuExtractionReview(review.status)) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadReview(sourcePublicId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadReview, review?.status, sourcePublicId]);

  const runExtract = useCallback(
    async (sourceId: string, idempotencyKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/${sourceId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });
      const payload = (await response.json()) as { review: Review | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Extraction failed.");
      }
      if (payload.review) {
        setReview(payload.review);
        setDraft(payload.review.candidates);
      }
      await loadReview(sourceId);
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  },
    [base, loadReview],
  );

  const uploadFile = useCallback(
    async (selected: File) => {
      setBusy(true);
      setError(null);
      setReview(null);
      setDraft([]);
      setFieldErrors({});
      setExtractRetryNonce(null);
      try {
        const form = new FormData();
        form.set("file", selected);
        const response = await staffApiFetch(`${base}/upload`, { method: "POST", body: form });
        const payload = (await response.json()) as { sourcePublicId: string; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Upload failed.");
        }
        setSourcePublicId(payload.sourcePublicId);
        const idempotencyKey = menuExtractionExtractIdempotencyKey(payload.sourcePublicId);
        await runExtract(payload.sourcePublicId, idempotencyKey);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
        setBusy(false);
      }
    },
    [base, runExtract],
  );

  const extract = useCallback(async () => {
    if (!sourcePublicId || !extractKey) {
      return;
    }
    await runExtract(sourcePublicId, extractKey);
  }, [extractKey, runExtract, sourcePublicId]);

  const retryExtract = useCallback(async () => {
    if (!sourcePublicId) {
      return;
    }
    const nonce = crypto.randomUUID();
    setExtractRetryNonce(nonce);
    await runExtract(sourcePublicId, menuExtractionExtractIdempotencyKey(sourcePublicId, nonce));
  }, [runExtract, sourcePublicId]);

  const saveDraft = useCallback(async () => {
    if (!sourcePublicId || !review) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/${sourcePublicId}/candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runPublicId: review.runPublicId,
          expectedVersion: review.candidatesRevision,
          candidates: draft.map((row) => ({
            candidateKey: row.candidateKey,
            excluded: row.excluded,
            payload: row.payload,
          })),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Save failed.");
      }
      await loadReview(sourcePublicId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }, [base, draft, loadReview, review, sourcePublicId]);

  const confirm = useCallback(async () => {
    if (!sourcePublicId || !review) {
      return;
    }
    const nextFieldErrors: Record<string, string> = {};
    for (const row of draft) {
      if (row.excluded) {
        continue;
      }
      for (const issue of menuExtractionConfirmFieldIssues(row.payload)) {
        nextFieldErrors[`${row.candidateKey}:${issue.field}`] = issue.message;
      }
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(t.missingArabicName);
      return;
    }
    setFieldErrors({});
    await saveDraft();
    setBusy(true);
    try {
      const latestReviewResponse = await staffApiFetch(`${base}/${sourcePublicId}/review`);
      const latestPayload = (await latestReviewResponse.json()) as { review: Review | null };
      const latestReview = latestPayload.review;
      if (!latestReview) {
        throw new Error("Extraction review is not available.");
      }
      const response = await staffApiFetch(`${base}/${sourcePublicId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runPublicId: latestReview.runPublicId,
          expectedVersion: latestReview.candidatesRevision,
          importIdempotencyKey: confirmKey,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Confirm failed.");
      }
      await loadReview(sourcePublicId);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Confirm failed.");
    } finally {
      setBusy(false);
    }
  }, [base, confirmKey, draft, loadReview, review, saveDraft, sourcePublicId, t.missingArabicName]);

  const reject = useCallback(async () => {
    if (!sourcePublicId || !review) {
      return;
    }
    setBusy(true);
    try {
      const response = await staffApiFetch(`${base}/${sourcePublicId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runPublicId: review.runPublicId }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Reject failed.");
      }
      await loadReview(sourcePublicId);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Reject failed.");
    } finally {
      setBusy(false);
    }
  }, [base, loadReview, review, sourcePublicId]);

  return (
    <section className="stack gap-4" dir={dir}>
      <header className="stack gap-1">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.intro}</p>
        <p className="text-xs text-muted-foreground">{t.injectionNotice}</p>
        <p className="text-xs text-muted-foreground">{t.modelEstimate}</p>
      </header>

      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

      <div className="flex flex-wrap gap-2 items-end">
        <input
          ref={fileInputRef}
          id="menu-extraction-upload-input"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) {
              void uploadFile(selected);
            }
          }}
        />
        <label htmlFor="menu-extraction-upload-input" className={`btn ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {t.upload}
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy || !sourcePublicId}
          onClick={() => void extract()}
        >
          {t.extract}
        </button>
      </div>

      {review && sourcePublicId ? (
        <div className="stack gap-3">
          <p className="text-sm">
            Run {review.runPublicId} ·{" "}
            {menuExtractionRunStatusLabel(review.status, uiLocale, review.decision)}
            {shouldPollMenuExtractionReview(review.status) ? ` · ${t.extractionInProgress}` : ""}
            {!review.gateReady ? ` · ${t.gateBlocked}` : ""}
          </p>
          {reviewCancelled ? (
            <p className="text-sm" role="status">{t.reviewCancelled}</p>
          ) : null}
          {review.status === "failed" ? (
            <div className="stack gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-medium">{t.extractionFailed}</p>
              <p>
                {menuExtractionFailureMessage(
                  review.failureCode,
                  uiLocale,
                  review.failureMessage,
                )}
              </p>
              <button type="button" className="btn btn-secondary w-fit" disabled={busy} onClick={() => void retryExtract()}>
                {t.retry}
              </button>
            </div>
          ) : null}
          {review.candidates.length === 0 ? (
            <p className="text-sm">{t.noCandidates}</p>
          ) : (
            <div className="overflow-x-auto border rounded-md">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left">
                    <th className="p-2">{t.pagePreview}</th>
                    <th className="p-2">EN name</th>
                    <th className="p-2">AR name</th>
                    <th className="p-2">Price</th>
                    <th className="p-2">{t.excluded}</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((row, index) => {
                    const page = row.payload.evidence.pageNumber;
                    const priceFlag = row.payload.uncertainty.price;
                    return (
                      <tr key={row.candidateKey} className="border-t align-top">
                        <td className="p-2">
                          <img
                            alt={`${t.pagePreview} ${page}`}
                            className="max-w-[160px] border"
                            src={`${base}/${sourcePublicId}/pages/${page}`}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            className="w-full border rounded px-2 py-1"
                            disabled={reviewClosed || busy}
                            value={row.payload.displayNameEn ?? ""}
                            onChange={(event) => {
                              const next = [...draft];
                              next[index] = {
                                ...row,
                                payload: {
                                  ...row.payload,
                                  displayNameEn: event.target.value || null,
                                },
                              };
                              setDraft(next);
                            }}
                          />
                          <span className={`text-xs px-1 rounded ${uncertaintyClass(row.payload.uncertainty.displayNameEn)}`}>
                            {row.payload.uncertainty.displayNameEn}
                          </span>
                        </td>
                        <td className="p-2">
                          <input
                            className={`w-full border rounded px-2 py-1 ${
                              fieldErrors[`${row.candidateKey}:displayNameAr`]
                                ? "border-red-600 ring-1 ring-red-200"
                                : ""
                            }`}
                            dir="rtl"
                            disabled={reviewClosed || busy}
                            required={!row.excluded}
                            aria-invalid={Boolean(fieldErrors[`${row.candidateKey}:displayNameAr`])}
                            value={row.payload.displayNameAr ?? ""}
                            onChange={(event) => {
                              const next = [...draft];
                              next[index] = {
                                ...row,
                                payload: {
                                  ...row.payload,
                                  displayNameAr: event.target.value || null,
                                },
                              };
                              setDraft(next);
                              if (fieldErrors[`${row.candidateKey}:displayNameAr`]) {
                                const { [`${row.candidateKey}:displayNameAr`]: _, ...rest } = fieldErrors;
                                setFieldErrors(rest);
                              }
                            }}
                          />
                          {fieldErrors[`${row.candidateKey}:displayNameAr`] ? (
                            <p className="text-xs text-red-700" role="alert">
                              {t.requiredField}
                            </p>
                          ) : null}
                          <span className={`text-xs px-1 rounded ${uncertaintyClass(row.payload.uncertainty.displayNameAr)}`}>
                            {row.payload.uncertainty.displayNameAr}
                          </span>
                        </td>
                        <td className="p-2">
                          <input
                            className="w-full border rounded px-2 py-1"
                            disabled={reviewClosed || busy}
                            value={row.payload.priceText ?? ""}
                            onChange={(event) => {
                              const next = [...draft];
                              next[index] = {
                                ...row,
                                payload: {
                                  ...row.payload,
                                  priceText: event.target.value || null,
                                },
                              };
                              setDraft(next);
                            }}
                          />
                          <span className={`text-xs px-1 rounded ${uncertaintyClass(priceFlag)}`}>
                            {priceFlag}
                          </span>
                        </td>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            disabled={reviewClosed || busy}
                            checked={row.excluded}
                            onChange={(event) => {
                              const next = [...draft];
                              next[index] = { ...row, excluded: event.target.checked };
                              setDraft(next);
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy || reviewClosed}
              onClick={() => void saveDraft()}
            >
              Save edits
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || reviewClosed}
              onClick={() => void confirm()}
            >
              {t.confirm}
            </button>
            <button type="button" className="btn" disabled={busy || reviewClosed} onClick={() => void reject()}>
              {t.reject}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
