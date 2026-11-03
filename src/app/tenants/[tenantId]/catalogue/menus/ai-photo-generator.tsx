"use client";

import { useMemo, useState } from "react";

import { AiPhotoProvenanceMeta } from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-provenance-meta";
import {
  allowanceLabel,
  costLabel,
  failureMessage,
  generateActionState,
  missingPhotoItems,
  effectiveAiPhotoItemProgress,
  generationForAiPhotoRow,
  progressFromBatchItem,
  readyCandidates,
  runBounded,
  selectAllState,
  type ItemProgress,
} from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-view";
import {
  menusCopy,
  menusCount,
  type MenusCopyKey,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Drawer } from "@/components/Drawer";
import { ConfirmDialog } from "@/components/Modal";
import { Icon } from "@/components/Icon";
import { publicProductThumbnailUrl } from "@/components/platform/catalogue-products-list";
import { Checkbox } from "@/design-system/components/primitives/Checkbox";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import type {
  AiPhotoBatchItem,
  AiPhotoCandidateView,
  MenuAiPhotosView,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import {
  fetchCatalogueProductVersion,
  removeProductPrimaryPhotoClient,
} from "@/lib/media/remove-product-primary-photo-client";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffUiCopy } from "@/lib/staff/locale";

/** Each request generates one image; two at a time keeps per-item progress visible without bursting the provider. */
const GENERATION_CONCURRENCY = 2;

type CandidatePayload = { candidate?: AiPhotoCandidateView; error?: string; code?: string };
type BatchPayload = { items?: AiPhotoBatchItem[]; error?: string; code?: string };

type AiPhotoGeneratorProps = {
  tenantId: string;
  menuPublicId: string;
  open: boolean;
  onClose: () => void;
  report: MenuHealthReport | null;
  aiPhotos: MenuAiPhotosView | null;
  /** Why the AI photo state could not be loaded, shown instead of a misleading empty allowance. */
  aiPhotosError: string | null;
  progress: Record<string, ItemProgress>;
  onProgress: (productPublicId: string, next: ItemProgress | null) => void;
  /** Called after generations or accepts so health, thumbnails and the daily allowance reload. */
  onChanged: () => void;
};

async function readCandidate(response: Response) {
  return (await response.json().catch(() => ({}))) as CandidatePayload;
}

export function AiPhotoGenerator({
  tenantId,
  menuPublicId,
  open,
  onClose,
  report,
  aiPhotos,
  aiPhotosError,
  progress,
  onProgress,
  onChanged,
}: AiPhotoGeneratorProps) {
  const { locale } = useStaffLocale();
  const copy = (key: MenusCopyKey, values?: Record<string, string | number>) =>
    menusCopy(locale, key, values);
  const attachedGeneration = aiPhotos?.attachedAiPhotoGenerationByProductPublicId ?? {};
  const [selected, setSelected] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [accuracyConfirmed, setAccuracyConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingProductPublicId, setRemovingProductPublicId] = useState<string | null>(null);
  const [pendingRemoveProductPublicId, setPendingRemoveProductPublicId] = useState<string | null>(
    null,
  );

  const basePath = `/api/tenants/${tenantId}/catalogue/menus/${menuPublicId}/ai-photos`;
  const availability = aiPhotos?.availability ?? null;
  const canAccept = availability?.canGenerate ?? false;

  const items = useMemo(() => {
    if (!report) {
      return [];
    }
    const missing = missingPhotoItems(report);
    const missingIds = new Set(missing.map((item) => item.productPublicId));
    const addedThisSession = report.products
      .filter((product) => !missingIds.has(product.productPublicId) && progress[product.productPublicId]?.state === "accepted")
      .map(({ productPublicId, displayName }) => ({ productPublicId, displayName }));
    return [...missing, ...addedThisSession];
  }, [progress, report]);

  const thumbnails = useMemo(
    () => new Map((report?.products ?? []).map((product) => [product.productPublicId, product.thumbnailPublicId])),
    [report],
  );

  const selectable = items
    .filter((item) => {
      const state = progress[item.productPublicId]?.state;
      return state === undefined || state === "failed" || state === "rejected";
    })
    .map((item) => item.productPublicId);
  const chosen = selected.filter((id) => selectable.includes(id));
  const allState = selectAllState(chosen, selectable);
  const action = generateActionState(chosen.length, availability, generating, aiPhotosError, locale);
  const ready = readyCandidates(progress);
  const needsReplace = Object.values(progress).filter((entry) => entry.state === "needs_replace").length;

  function toggle(productPublicId: string) {
    setSelected((current) =>
      current.includes(productPublicId)
        ? current.filter((id) => id !== productPublicId)
        : [...current, productPublicId],
    );
  }

  async function generateOne(productPublicId: string) {
    onProgress(productPublicId, { state: "generating" });
    try {
      const response = await staffApiFetch(basePath, {
        method: "POST",
        body: JSON.stringify({ productPublicId }),
      });
      const payload = await readCandidate(response);
      const candidate = payload.candidate;
      if (candidate?.status === "pending_review") {
        onProgress(productPublicId, { state: "ready", candidate });
      } else if (payload.code === "generation_in_progress") {
        onProgress(productPublicId, { state: "generating" });
      } else {
        onProgress(productPublicId, {
          state: "failed",
          message: failureMessage(candidate?.failureCode, payload.error, locale),
          candidate,
        });
      }
    } catch {
      onProgress(productPublicId, { state: "failed", message: copy("aiNetworkError") });
    }
  }

  async function queueBatch(queue: readonly string[]) {
    try {
      const response = await staffApiFetch(`${basePath}/batch`, {
        method: "POST",
        body: JSON.stringify({ productPublicIds: queue }),
      });
      const payload = (await response.json().catch(() => ({}))) as BatchPayload;
      if (!response.ok || !payload.items) {
        for (const id of queue) {
          onProgress(id, { state: "failed", message: payload.error ?? copy("aiCouldNotQueueBatch") });
        }
        return;
      }
      for (const item of payload.items) {
        onProgress(item.productPublicId, progressFromBatchItem(item, locale));
      }
    } catch {
      for (const id of queue) {
        onProgress(id, { state: "failed", message: copy("aiNetworkError") });
      }
    }
  }

  async function generateSelected() {
    const queue = [...chosen];
    if (queue.length === 0) {
      return;
    }
    setGenerating(true);
    setError(null);
    setSelected([]);
    for (const id of queue) {
      onProgress(id, { state: "queued" });
    }
    try {
      if (availability?.executionMode === "queued_worker") {
        await queueBatch(queue);
      } else {
        await runBounded(queue, GENERATION_CONCURRENCY, generateOne);
      }
    } finally {
      setGenerating(false);
      onChanged();
    }
  }

  async function accept(candidate: AiPhotoCandidateView, replaceExisting = false) {
    onProgress(candidate.productPublicId, { state: "saving", candidate });
    try {
      const response = await staffApiFetch(`${basePath}/${candidate.assetPublicId}/accept`, {
        method: "POST",
        body: JSON.stringify({ accuracyConfirmed, replaceExisting }),
      });
      const payload = await readCandidate(response);
      if (response.ok) {
        onProgress(candidate.productPublicId, { state: "accepted" });
        return true;
      }
      if (payload.code === "existing_photo") {
        onProgress(candidate.productPublicId, {
          state: "needs_replace",
          message: payload.error ?? copy("aiAlreadyHasPhoto"),
          candidate,
        });
      } else if (payload.code === "accuracy_review_required") {
        onProgress(candidate.productPublicId, { state: "ready", candidate });
        setError(payload.error ?? copy("aiConfirmBeforeUse"));
      } else if (payload.code === "stale_candidate") {
        onProgress(candidate.productPublicId, {
          state: "stale",
          message: staffUiCopy(locale, "aiPhotoStaleMessage"),
          candidate: payload.candidate ?? candidate,
        });
      } else {
        onProgress(candidate.productPublicId, {
          state: "failed",
          message: payload.error ?? copy("aiCouldNotSave"),
          candidate,
        });
      }
    } catch {
      onProgress(candidate.productPublicId, { state: "ready", candidate });
      setError(copy("aiNetworkError"));
    }
    return false;
  }

  async function acceptAll() {
    setError(null);
    await runBounded(ready, GENERATION_CONCURRENCY, async (candidate) => {
      await accept(candidate);
    });
    onChanged();
  }

  async function acceptOne(candidate: AiPhotoCandidateView, replaceExisting = false) {
    setError(null);
    if (await accept(candidate, replaceExisting)) {
      onChanged();
    }
  }

  async function reject(candidate: AiPhotoCandidateView) {
    onProgress(candidate.productPublicId, { state: "saving", candidate });
    try {
      const response = await staffApiFetch(`${basePath}/${candidate.assetPublicId}/reject`, { method: "POST" });
      const payload = await readCandidate(response);
      if (response.ok) {
        onProgress(candidate.productPublicId, { state: "rejected" });
      } else {
        onProgress(candidate.productPublicId, { state: "ready", candidate });
        setError(payload.error ?? copy("aiCouldNotDiscard"));
      }
    } catch {
      onProgress(candidate.productPublicId, { state: "ready", candidate });
      setError(copy("aiNetworkError"));
    }
  }

  function statusLine(productPublicId: string, entry: ItemProgress | undefined) {
    switch (entry?.state) {
      case "queued":
        return copy("aiStatusWaiting");
      case "generating":
        return copy("aiStatusGenerating");
      case "ready":
        return copy("aiStatusReady");
      case "saving":
        return copy("aiStatusSaving");
      case "accepted":
        return copy("aiStatusAdded");
      case "rejected":
        return copy("aiStatusDiscarded");
      case "failed":
      case "needs_replace":
        return entry.message;
      case "stale":
        return staffUiCopy(locale, "aiPhotoStaleMessage");
      default:
        return null;
    }
  }

  async function removeAttachedPhoto(productPublicId: string) {
    setRemovingProductPublicId(productPublicId);
    setError(null);
    try {
      const version = await fetchCatalogueProductVersion(tenantId, productPublicId);
      await removeProductPrimaryPhotoClient(tenantId, productPublicId, version);
      onProgress(productPublicId, null);
      onChanged();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : copy("unableToRemovePhoto"),
      );
    } finally {
      setRemovingProductPublicId(null);
    }
  }

  function canRemoveAttachedPhoto(productPublicId: string, entry: ItemProgress | undefined) {
    if (!thumbnails.get(productPublicId)) {
      return false;
    }
    if (entry?.state === "accepted") {
      return true;
    }
    return Boolean(attachedGeneration[productPublicId]);
  }

  function thumb(productPublicId: string, entry: ItemProgress | undefined) {
    const candidate =
      entry && "candidate" in entry && entry.candidate?.previewPath ? entry.candidate : null;
    const thumbnailPublicId = thumbnails.get(productPublicId) ?? null;
    if (candidate && entry?.state !== "accepted") {
      return (
        <span className="qos-thumb" data-size="lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated preview */}
          <img src={candidate.previewPath!} alt="" />
          <span className="qos-thumb-tag" title={staffUiCopy(locale, "aiGeneratedImageTitle")}>
            AI
          </span>
        </span>
      );
    }
    if (thumbnailPublicId) {
      return (
        <span className="qos-thumb" data-size="lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- matches catalogue thumbnails */}
          <img src={publicProductThumbnailUrl(thumbnailPublicId)} alt="" />
          {entry?.state === "accepted" || attachedGeneration[productPublicId] ? (
            <span className="qos-thumb-tag" title={staffUiCopy(locale, "aiGeneratedImageTitle")}>
              AI
            </span>
          ) : null}
        </span>
      );
    }
    return (
      <span className="qos-thumb" data-size="lg" data-empty="true">
        {entry?.state === "generating" || entry?.state === "queued" ? (
          <Icon name="loader" size={18} className="qos-spin" />
        ) : (
          <Icon name="camera" size={18} />
        )}
      </span>
    );
  }

  const needCount = report ? missingPhotoItems(report).length : 0;

  return (
    <Drawer
      open={open}
      placement="sheet"
      width={480}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span className="qos-thumb" style={{ width: 36, height: 36, background: "var(--intelligence-surface)", color: "var(--text-intelligence)" }}>
            <Icon name="sparkles" size={18} />
          </span>
          {copy("aiGeneratorTitle")}
        </span>
      }
      description={menusCount(locale, "itemsMissingPhotos", needCount)}
      onClose={onClose}
      footer={
        <div className="qos-ai-foot">
          <div className="qos-credit-row">
            <div className="qos-credit-cell">
              <Icon name="receipt" size={16} />
              <div>
                <div className="qos-credit-label">{copy("aiLeftToday")}</div>
                <div className="qos-credit-value">
                  {allowanceLabel(availability, aiPhotosError, locale)}
                </div>
              </div>
            </div>
            <div className="qos-credit-cell">
              <Icon name="sparkles" size={16} />
              <div>
                <div className="qos-credit-label">{copy("aiCost")}</div>
                <div className="qos-credit-value">{costLabel(chosen.length, locale)}</div>
              </div>
            </div>
          </div>
          {action.hint ? <p className="qos-card-sub">{action.hint}</p> : null}
          <Button
            variant="intelligence"
            icon="sparkles"
            fullWidth
            disabled={action.disabled}
            loading={generating}
            onClick={() => void generateSelected()}
          >
            {action.label}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        {ready.length + needsReplace > 0 ? (
          <Alert
            tone="intelligence"
            title={menusCount(locale, "imagesReadyToReview", ready.length + needsReplace)}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <span>{copy("aiIllustrationNotice")}</span>
              {canAccept ? (
                <>
                  <Checkbox
                    label={copy("aiAccuracyConfirm")}
                    checked={accuracyConfirmed}
                    onChange={() => setAccuracyConfirmed((current) => !current)}
                  />
                  {ready.length > 1 ? (
                    <div>
                      <Button
                        size="sm"
                        variant="primary"
                        icon="check"
                        disabled={!accuracyConfirmed}
                        onClick={() => void acceptAll()}
                      >
                        {copy("aiUseAll", { count: ready.length })}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <span>{copy("aiAdminMustAccept")}</span>
              )}
            </div>
          </Alert>
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}

        {items.length === 0 ? (
          <p className="qos-card-sub">{copy("aiEveryItemHasPhoto")}</p>
        ) : (
          <>
            <Checkbox
              label={copy("aiSelectAll")}
              checked={allState === "all"}
              indeterminate={allState === "some"}
              disabled={selectable.length === 0 || generating}
              onChange={() => setSelected(allState === "all" ? [] : selectable)}
            />
            <ul className="qos-ai-list" aria-label={copy("aiItemsMissingPhotosLabel")}>
              {items.map((item) => {
                const entry = effectiveAiPhotoItemProgress(
                  item.productPublicId,
                  progress[item.productPublicId],
                  aiPhotos,
                  locale,
                );
                const isSelectable = selectable.includes(item.productPublicId);
                const line = statusLine(item.productPublicId, entry);
                return (
                  <li key={item.productPublicId} className="qos-ai-item">
                    <Checkbox
                      label={<span className="sr-only">{copy("aiSelectItem", { name: item.displayName })}</span>}
                      checked={chosen.includes(item.productPublicId)}
                      disabled={!isSelectable || generating}
                      onChange={() => toggle(item.productPublicId)}
                    />
                    {thumb(item.productPublicId, entry)}
                    <div className="qos-ai-item-main">
                      <div className="qos-menu-row-name">{item.displayName}</div>
                      {line ? (
                        <div
                          className="qos-menu-row-meta"
                          style={
                            entry?.state === "failed" ||
                            entry?.state === "needs_replace" ||
                            entry?.state === "stale"
                              ? { color: "var(--status-error-fg)", whiteSpace: "normal" }
                              : undefined
                          }
                        >
                          {line}
                        </div>
                      ) : null}
                      <AiPhotoProvenanceMeta
                        locale={locale}
                        generation={generationForAiPhotoRow(item.productPublicId, entry, aiPhotos)}
                      />
                    </div>
                    {entry?.state === "ready" && canAccept ? (
                      <div className="qos-ai-item-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!accuracyConfirmed}
                          onClick={() => void acceptOne(entry.candidate)}
                        >
                          {copy("aiUse")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          {staffUiCopy(locale, "discard")}
                        </Button>
                      </div>
                    ) : null}
                    {entry?.state === "ready" && !canAccept ? (
                      <div className="qos-ai-item-actions">
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          {staffUiCopy(locale, "discard")}
                        </Button>
                      </div>
                    ) : null}
                    {entry?.state === "needs_replace" ? (
                      <div className="qos-ai-item-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!accuracyConfirmed}
                          onClick={() => void acceptOne(entry.candidate, true)}
                        >
                          {copy("aiReplace")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          {staffUiCopy(locale, "discard")}
                        </Button>
                      </div>
                    ) : null}
                    {entry?.state === "stale" ? (
                      <div className="qos-ai-item-actions">
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          {staffUiCopy(locale, "discard")}
                        </Button>
                      </div>
                    ) : null}
                    {canRemoveAttachedPhoto(item.productPublicId, entry) ? (
                      <div className="qos-ai-item-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={removingProductPublicId === item.productPublicId}
                          onClick={() => setPendingRemoveProductPublicId(item.productPublicId)}
                        >
                          {staffUiCopy(locale, "removeProductPhoto")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingRemoveProductPublicId !== null}
        tone="danger"
        title={staffUiCopy(locale, "removeProductPhotoConfirmTitle")}
        description={staffUiCopy(locale, "removeProductPhotoConfirmDescription")}
        confirmLabel={staffUiCopy(locale, "removeProductPhotoConfirmLabel")}
        cancelLabel={staffUiCopy(locale, "cancel")}
        onClose={() => setPendingRemoveProductPublicId(null)}
        onConfirm={() => {
          const productPublicId = pendingRemoveProductPublicId;
          setPendingRemoveProductPublicId(null);
          if (productPublicId) {
            void removeAttachedPhoto(productPublicId);
          }
        }}
      />
    </Drawer>
  );
}
