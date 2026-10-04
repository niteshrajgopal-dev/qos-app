"use client";

import { useMemo, useState } from "react";

import {
  allowanceLabel,
  costLabel,
  failureMessage,
  generateActionState,
  missingPhotoItems,
  progressFromBatchItem,
  readyCandidates,
  runBounded,
  selectAllState,
  type ItemProgress,
} from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-view";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Drawer } from "@/components/Drawer";
import { Icon } from "@/components/Icon";
import { publicProductThumbnailUrl } from "@/components/platform/catalogue-products-list";
import { Checkbox } from "@/design-system/components/primitives/Checkbox";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import type {
  AiPhotoBatchItem,
  AiPhotoCandidateView,
  MenuAiPhotosView,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

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
  onProgress: (productPublicId: string, next: ItemProgress) => void;
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
  const [selected, setSelected] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [accuracyConfirmed, setAccuracyConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const action = generateActionState(chosen.length, availability, generating, aiPhotosError);
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
          message: failureMessage(candidate?.failureCode, payload.error),
          candidate,
        });
      }
    } catch {
      onProgress(productPublicId, { state: "failed", message: "Network error. Try again." });
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
          onProgress(id, { state: "failed", message: payload.error ?? "These photos could not be queued." });
        }
        return;
      }
      for (const item of payload.items) {
        onProgress(item.productPublicId, progressFromBatchItem(item));
      }
    } catch {
      for (const id of queue) {
        onProgress(id, { state: "failed", message: "Network error. Try again." });
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
          message: payload.error ?? "This item already has a photo.",
          candidate,
        });
      } else if (payload.code === "accuracy_review_required") {
        onProgress(candidate.productPublicId, { state: "ready", candidate });
        setError(payload.error ?? "Confirm the images before using them.");
      } else {
        onProgress(candidate.productPublicId, {
          state: "failed",
          message: payload.error ?? "The photo could not be saved.",
          candidate,
        });
      }
    } catch {
      onProgress(candidate.productPublicId, { state: "ready", candidate });
      setError("Network error. Try again.");
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
        setError(payload.error ?? "The photo could not be discarded.");
      }
    } catch {
      onProgress(candidate.productPublicId, { state: "ready", candidate });
      setError("Network error. Try again.");
    }
  }

  function statusLine(productPublicId: string) {
    const entry = progress[productPublicId];
    switch (entry?.state) {
      case "queued":
        return "Waiting…";
      case "generating":
        return "Generating…";
      case "ready":
        return "Ready to review · AI-generated";
      case "saving":
        return "Saving…";
      case "accepted":
        return "Added to draft · AI-generated";
      case "rejected":
        return "Discarded";
      case "failed":
      case "needs_replace":
        return entry.message;
      default:
        return null;
    }
  }

  function thumb(productPublicId: string) {
    const entry = progress[productPublicId];
    const candidate =
      entry && "candidate" in entry && entry.candidate?.previewPath ? entry.candidate : null;
    const thumbnailPublicId = thumbnails.get(productPublicId) ?? null;
    if (candidate && entry?.state !== "accepted") {
      return (
        <span className="qos-thumb" data-size="lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated preview */}
          <img src={candidate.previewPath!} alt="" />
          <span className="qos-thumb-tag">AI</span>
        </span>
      );
    }
    if (thumbnailPublicId) {
      return (
        <span className="qos-thumb" data-size="lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- matches catalogue thumbnails */}
          <img src={publicProductThumbnailUrl(thumbnailPublicId)} alt="" />
          {entry?.state === "accepted" ? <span className="qos-thumb-tag">AI</span> : null}
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
          AI photo generator
        </span>
      }
      description={`${needCount} ${needCount === 1 ? "item" : "items"} missing photos`}
      onClose={onClose}
      footer={
        <div className="qos-ai-foot">
          <div className="qos-credit-row">
            <div className="qos-credit-cell">
              <Icon name="receipt" size={16} />
              <div>
                <div className="qos-credit-label">Left today</div>
                <div className="qos-credit-value">
                  {allowanceLabel(availability, aiPhotosError)}
                </div>
              </div>
            </div>
            <div className="qos-credit-cell">
              <Icon name="sparkles" size={16} />
              <div>
                <div className="qos-credit-label">Cost</div>
                <div className="qos-credit-value">{costLabel(chosen.length)}</div>
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
            title={`${ready.length + needsReplace} ${ready.length + needsReplace === 1 ? "image" : "images"} ready to review`}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <span>
                AI images are illustrations, not photos of your actual items. Accepted images are
                added to the draft menu; customers only see them after you publish.
              </span>
              {canAccept ? (
                <>
                  <Checkbox
                    label="I've checked these images fairly represent the items"
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
                        Use all {ready.length}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <span>An administrator needs to accept these images.</span>
              )}
            </div>
          </Alert>
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}

        {items.length === 0 ? (
          <p className="qos-card-sub">Every item on this menu has a photo.</p>
        ) : (
          <>
            <Checkbox
              label="Select all"
              checked={allState === "all"}
              indeterminate={allState === "some"}
              disabled={selectable.length === 0 || generating}
              onChange={() => setSelected(allState === "all" ? [] : selectable)}
            />
            <ul className="qos-ai-list" aria-label="Items missing photos">
              {items.map((item) => {
                const entry = progress[item.productPublicId];
                const isSelectable = selectable.includes(item.productPublicId);
                const line = statusLine(item.productPublicId);
                return (
                  <li key={item.productPublicId} className="qos-ai-item">
                    <Checkbox
                      label={<span className="sr-only">Select {item.displayName}</span>}
                      checked={chosen.includes(item.productPublicId)}
                      disabled={!isSelectable || generating}
                      onChange={() => toggle(item.productPublicId)}
                    />
                    {thumb(item.productPublicId)}
                    <div className="qos-ai-item-main">
                      <div className="qos-menu-row-name">{item.displayName}</div>
                      {line ? (
                        <div
                          className="qos-menu-row-meta"
                          style={
                            entry?.state === "failed" || entry?.state === "needs_replace"
                              ? { color: "var(--status-error-fg)", whiteSpace: "normal" }
                              : undefined
                          }
                        >
                          {line}
                        </div>
                      ) : null}
                    </div>
                    {entry?.state === "ready" && canAccept ? (
                      <div className="qos-ai-item-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!accuracyConfirmed}
                          onClick={() => void acceptOne(entry.candidate)}
                        >
                          Use
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          Discard
                        </Button>
                      </div>
                    ) : null}
                    {entry?.state === "ready" && !canAccept ? (
                      <div className="qos-ai-item-actions">
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          Discard
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
                          Replace
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void reject(entry.candidate)}>
                          Discard
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
    </Drawer>
  );
}
