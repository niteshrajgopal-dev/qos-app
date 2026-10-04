import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import type {
  AiPhotoAvailabilityView,
  AiPhotoBatchItem,
  AiPhotoCandidateView,
} from "@/lib/media/ai-photos/ai-photo-candidates";

export type MenuPhotoSummary = {
  totalItems: number;
  withPhotos: number;
  needPhotos: number;
};

/** Only approved, attached photos count; pending AI candidates do not. */
export function menuPhotoSummary(report: MenuHealthReport): MenuPhotoSummary {
  const withPhotos = report.products.filter((product) => product.thumbnailPublicId !== null).length;
  return {
    totalItems: report.products.length,
    withPhotos,
    needPhotos: report.products.length - withPhotos,
  };
}

export type MissingPhotoItem = {
  productPublicId: string;
  displayName: string;
};

export function missingPhotoItems(report: MenuHealthReport): MissingPhotoItem[] {
  return report.products
    .filter((product) => product.thumbnailPublicId === null)
    .map(({ productPublicId, displayName }) => ({ productPublicId, displayName }));
}

export function thumbnailsByProduct(report: MenuHealthReport | null) {
  return new Map(
    (report?.products ?? [])
      .filter((product) => product.thumbnailPublicId !== null)
      .map((product) => [product.productPublicId, product.thumbnailPublicId!]),
  );
}

export function selectAllState(selected: readonly string[], selectable: readonly string[]) {
  const chosen = selectable.filter((id) => selected.includes(id)).length;
  if (chosen === 0) {
    return "none" as const;
  }
  return chosen === selectable.length ? ("all" as const) : ("some" as const);
}

export function itemsNeedPhotosLabel(count: number) {
  return `${count} ${count === 1 ? "item needs a photo" : "items need photos"}`;
}

export const AI_PHOTO_UNAVAILABLE_COPY: Record<
  NonNullable<AiPhotoAvailabilityView["unavailableReason"]>,
  string
> = {
  disabled: "AI photos are turned off for this environment. Ask your QOS operator to enable them.",
  not_configured: "AI photos are not set up yet. Ask your QOS operator to finish configuration.",
  spend_policy_unset: "AI photos are waiting for a spend limit. Ask your QOS operator to set one.",
};

export type GenerateActionState = {
  disabled: boolean;
  label: string;
  hint: string | null;
};

/** Primary CTA for the generator sheet: disabled until at least one item is selected and allowed. */
export function generateActionState(
  selectedCount: number,
  availability: AiPhotoAvailabilityView | null,
  busy: boolean,
  loadError: string | null = null,
): GenerateActionState {
  if (busy) {
    return { disabled: true, label: "Generating…", hint: null };
  }
  if (!availability) {
    return { disabled: true, label: "Select items to generate", hint: loadError };
  }
  if (!availability.available) {
    return {
      disabled: true,
      label: "AI photos unavailable",
      hint: AI_PHOTO_UNAVAILABLE_COPY[availability.unavailableReason ?? "disabled"],
    };
  }
  if (!availability.canGenerate) {
    return {
      disabled: true,
      label: "Select items to generate",
      hint: "Only administrators can generate AI photos.",
    };
  }
  if (selectedCount === 0) {
    return { disabled: true, label: "Select items to generate", hint: null };
  }
  if (selectedCount > availability.remainingToday) {
    return {
      disabled: true,
      label: `Generate ${selectedCount} ${selectedCount === 1 ? "photo" : "photos"}`,
      hint:
        availability.remainingToday === 0
          ? "No AI photo generations left today."
          : `Only ${availability.remainingToday} left today. Select fewer items.`,
    };
  }
  return {
    disabled: false,
    label: `Generate ${selectedCount} ${selectedCount === 1 ? "photo" : "photos"}`,
    hint: null,
  };
}

/** Allowance cell: distinguishes "still loading", "failed to load" and "switched off" from a spent allowance. */
export function allowanceLabel(availability: AiPhotoAvailabilityView | null, loadError: string | null) {
  if (!availability) {
    return loadError ? "Unavailable" : "—";
  }
  if (!availability.available) {
    return "Off";
  }
  return `${availability.remainingToday} of ${availability.dailyLimit}`;
}

export function costLabel(selectedCount: number) {
  if (selectedCount === 0) {
    return "—";
  }
  return `${selectedCount} ${selectedCount === 1 ? "generation" : "generations"}`;
}

export const AI_PHOTO_FAILURE_COPY: Record<string, string> = {
  unsafe_output: "The image service declined this item. Try editing its description.",
  invalid_output: "The image service returned an unusable image.",
  provider_timeout: "The image service took too long. Try again.",
  provider_rate_limited: "The image service is busy. Try again later.",
  provider_auth: "The image service rejected QOS credentials. Contact your QOS operator.",
  provider_unreachable: "The image service could not be reached.",
  storage_failed: "The image could not be stored.",
  abandoned: "Generation did not finish.",
  outcome_unknown: "QOS could not confirm whether this image was generated. Your QOS operator will check it.",
  not_started_in_time: "This photo was not started in time. Nothing was charged. Try again.",
  requester_access_revoked: "The person who asked for this photo no longer has access.",
  product_unavailable: "This item was archived before its photo was generated.",
  ai_photos_unavailable: "AI photos were switched off before this photo was generated.",
  tenant_inactive: "This business is not active.",
};

export function failureMessage(code: string | null | undefined, fallback?: string) {
  return (code ? AI_PHOTO_FAILURE_COPY[code] : undefined) ?? fallback ?? "Generation failed.";
}

export type ItemProgress =
  | { state: "queued" }
  | { state: "generating" }
  | { state: "ready"; candidate: AiPhotoCandidateView }
  | { state: "saving"; candidate: AiPhotoCandidateView }
  | { state: "accepted" }
  | { state: "rejected" }
  | { state: "failed"; message: string; candidate?: AiPhotoCandidateView }
  | { state: "needs_replace"; message: string; candidate: AiPhotoCandidateView };

/** Seeds per-item progress from candidates already stored server-side. */
export function progressFromCandidates(candidates: readonly AiPhotoCandidateView[]) {
  const progress: Record<string, ItemProgress> = {};
  for (const candidate of candidates) {
    if (candidate.status === "pending_review") {
      progress[candidate.productPublicId] = { state: "ready", candidate };
    } else if (candidate.status === "generating") {
      progress[candidate.productPublicId] = { state: "generating" };
    } else if (candidate.status === "failed") {
      progress[candidate.productPublicId] = {
        state: "failed",
        message: failureMessage(candidate.failureCode),
        candidate,
      };
    }
  }
  return progress;
}

/**
 * Server state replaces items still waiting or generating locally (queued
 * work finishes on the worker); anything the user has acted on stays local.
 */
export function mergeServerProgress(
  current: Record<string, ItemProgress>,
  server: Record<string, ItemProgress>,
) {
  const merged = { ...server, ...current };
  for (const [productPublicId, entry] of Object.entries(server)) {
    const local = current[productPublicId]?.state;
    if (local === "queued" || local === "generating") {
      merged[productPublicId] = entry;
    }
  }
  return merged;
}

/** Queued photos finish on the AI worker; the editor re-reads their state this often. */
export const AI_PHOTO_POLL_INTERVAL_MS = 5_000;

export function hasWorkInFlight(progress: Record<string, ItemProgress>) {
  return Object.values(progress).some((entry) => entry.state === "queued" || entry.state === "generating");
}

/** Progress for one item of a queued batch admission. */
export function progressFromBatchItem(item: AiPhotoBatchItem): ItemProgress {
  switch (item.outcome) {
    case "queued":
    case "in_progress":
      return { state: "generating" };
    case "existing_candidate":
      return item.candidate?.status === "pending_review"
        ? { state: "ready", candidate: item.candidate }
        : { state: "generating" };
    default:
      return { state: "failed", message: item.message ?? "This photo could not be queued." };
  }
}

export function readyCandidates(progress: Record<string, ItemProgress>) {
  return Object.values(progress).flatMap((entry) =>
    entry.state === "ready" ? [entry.candidate] : [],
  );
}

/** Runs tasks with bounded parallelism; one task's failure never stops the rest. */
export async function runBounded<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await task(item);
      } catch {
        // Each task reports its own failure.
      }
    }
  });
  await Promise.all(workers);
}
