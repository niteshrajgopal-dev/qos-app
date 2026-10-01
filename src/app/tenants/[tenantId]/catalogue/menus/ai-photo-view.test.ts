import { describe, expect, it } from "vitest";

import {
  allowanceLabel,
  generateActionState,
  itemsNeedPhotosLabel,
  menuPhotoSummary,
  missingPhotoItems,
  progressFromCandidates,
  readyCandidates,
  runBounded,
  selectAllState,
} from "@/app/tenants/[tenantId]/catalogue/menus/ai-photo-view";
import type { MenuHealthReport } from "@/lib/catalogue/menu-health";
import type {
  AiPhotoAvailabilityView,
  AiPhotoCandidateView,
} from "@/lib/media/ai-photos/ai-photo-candidates";

function report(products: Array<{ id: string; thumb: string | null }>): MenuHealthReport {
  return {
    menuPublicId: "men_1",
    menuVersion: 1,
    menuDisplayName: "Menu",
    evaluatedAt: new Date(0).toISOString(),
    totals: { products: products.length, sections: 1, locations: 1, productsWithIssues: 0 },
    completeness: { percent: 50, passedChecks: 1, totalChecks: 2 },
    issueGroups: [],
    products: products.map((product) => ({
      productPublicId: product.id,
      displayName: product.id.toUpperCase(),
      internalName: product.id,
      thumbnailPublicId: product.thumb,
      issues: [],
    })),
    availability: { checkedLocations: [], closedLocations: [] },
  };
}

const available: AiPhotoAvailabilityView = {
  available: true,
  unavailableReason: null,
  canGenerate: true,
  dailyLimit: 20,
  usedToday: 17,
  remainingToday: 3,
};

function candidate(productPublicId: string, status: AiPhotoCandidateView["status"]): AiPhotoCandidateView {
  return {
    assetPublicId: `mas_${productPublicId}`,
    productPublicId,
    status,
    failureCode: status === "failed" ? "unsafe_output" : null,
    createdAt: new Date(0).toISOString(),
    previewPath: status === "pending_review" ? "/preview" : null,
  };
}

describe("menu photo summary", () => {
  it("counts only attached photos", () => {
    const value = report([
      { id: "a", thumb: "mda_a" },
      { id: "b", thumb: null },
      { id: "c", thumb: null },
    ]);
    expect(menuPhotoSummary(value)).toEqual({ totalItems: 3, withPhotos: 1, needPhotos: 2 });
    expect(missingPhotoItems(value).map((item) => item.productPublicId)).toEqual(["b", "c"]);
    expect(itemsNeedPhotosLabel(1)).toBe("1 item needs a photo");
    expect(itemsNeedPhotosLabel(38)).toBe("38 items need photos");
  });
});

describe("generator selection", () => {
  it("reports select-all state", () => {
    expect(selectAllState([], ["a", "b"])).toBe("none");
    expect(selectAllState(["a"], ["a", "b"])).toBe("some");
    expect(selectAllState(["a", "b", "zzz"], ["a", "b"])).toBe("all");
  });

  it("keeps the CTA disabled until something is selected and allowed", () => {
    expect(generateActionState(0, available, false)).toMatchObject({ disabled: true, label: "Select items to generate" });
    expect(generateActionState(2, available, false)).toEqual({ disabled: false, label: "Generate 2 photos", hint: null });
    expect(generateActionState(4, available, false)).toMatchObject({ disabled: true, hint: "Only 3 left today. Select fewer items." });
    expect(generateActionState(1, { ...available, canGenerate: false }, false)).toMatchObject({
      disabled: true,
      hint: "Only administrators can generate AI photos.",
    });
    expect(
      generateActionState(1, { ...available, available: false, canGenerate: false, unavailableReason: "disabled" }, false),
    ).toMatchObject({ disabled: true, label: "AI photos unavailable" });
    expect(generateActionState(1, available, true)).toMatchObject({ disabled: true, label: "Generating…" });
    expect(generateActionState(1, null, false).disabled).toBe(true);
    expect(generateActionState(1, null, false, "AI photos could not be loaded (HTTP 500).")).toMatchObject({
      disabled: true,
      hint: "AI photos could not be loaded (HTTP 500).",
    });
  });

  it("never reports a failed load or a switched-off feature as a spent allowance", () => {
    expect(allowanceLabel(null, null)).toBe("—");
    expect(allowanceLabel(null, "AI photos could not be loaded (HTTP 500).")).toBe("Unavailable");
    expect(allowanceLabel({ ...available, available: false, unavailableReason: "disabled" }, null)).toBe("Off");
    expect(allowanceLabel(available, null)).toBe(`${available.remainingToday} of ${available.dailyLimit}`);
    expect(allowanceLabel({ ...available, remainingToday: 0 }, null)).toBe(`0 of ${available.dailyLimit}`);
  });
});

describe("progress", () => {
  it("seeds progress from stored candidates", () => {
    const progress = progressFromCandidates([
      candidate("a", "pending_review"),
      candidate("b", "failed"),
      candidate("c", "generating"),
    ]);
    expect(progress.a).toMatchObject({ state: "ready" });
    expect(progress.b).toMatchObject({ state: "failed", message: expect.stringContaining("declined") });
    expect(progress.c).toEqual({ state: "generating" });
    expect(readyCandidates(progress).map((entry) => entry.productPublicId)).toEqual(["a"]);
  });

  it("runs every task with bounded concurrency even when some fail", async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await runBounded([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (item === 2) {
        throw new Error("boom");
      }
      done.push(item);
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 3, 4, 5]);
  });
});
