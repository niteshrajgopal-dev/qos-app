"use client";

import { useCallback, useMemo, useState } from "react";

import type { MenuExtractionCandidatePayload } from "@/db/schema";
import { menuExtractionCopy } from "@/lib/catalogue/menu-extraction/menu-extraction-ui-copy";
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

  const [file, setFile] = useState<File | null>(null);
  const [sourcePublicId, setSourcePublicId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Review["candidates"]>([]);

  const extractKey = useMemo(() => `extract-${crypto.randomUUID()}`, []);
  const confirmKey = useMemo(() => `confirm-${crypto.randomUUID()}`, []);

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

  const upload = useCallback(async () => {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await staffApiFetch(`${base}/upload`, { method: "POST", body: form });
      const payload = (await response.json()) as { sourcePublicId: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }
      setSourcePublicId(payload.sourcePublicId);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }, [base, file]);

  const extract = useCallback(async () => {
    if (!sourcePublicId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await staffApiFetch(`${base}/${sourcePublicId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: extractKey }),
      });
      const payload = (await response.json()) as { review: Review | null; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Extraction failed.");
      }
      if (payload.review) {
        setReview(payload.review);
        setDraft(payload.review.candidates);
      }
      await loadReview(sourcePublicId);
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }, [base, extractKey, loadReview, sourcePublicId]);

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
  }, [base, confirmKey, loadReview, review, saveDraft, sourcePublicId]);

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
        <label className="stack gap-1 text-sm">
          <span>{t.upload}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void upload()}>
          {t.upload}
        </button>
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
            Run {review.runPublicId} · {review.status}
            {!review.gateReady ? ` · ${t.gateBlocked}` : ""}
          </p>
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
                            className="w-full border rounded px-2 py-1"
                            dir="rtl"
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
                            }}
                          />
                          <span className={`text-xs px-1 rounded ${uncertaintyClass(row.payload.uncertainty.displayNameAr)}`}>
                            {row.payload.uncertainty.displayNameAr}
                          </span>
                        </td>
                        <td className="p-2">
                          <input
                            className="w-full border rounded px-2 py-1"
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
            <button type="button" className="btn" disabled={busy} onClick={() => void saveDraft()}>
              Save edits
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>
              {t.confirm}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void reject()}>
              {t.reject}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
