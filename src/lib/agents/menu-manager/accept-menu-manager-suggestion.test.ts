import { describe, expect, it } from "vitest";

import {
  assertSuggestionAcceptable,
  draftPatchForSuggestion,
  matchStoredSuggestion,
} from "@/lib/agents/menu-manager/accept-menu-manager-suggestion";
import { MENU_MANAGER_RESULT_SCHEMA } from "@/lib/agents/menu-manager/menu-manager-result";
import { reviewedMenuVersionFromStoredResult } from "@/lib/agents/menu-manager/menu-manager-reviewed-version";
import { readMenuManagerResult } from "@/app/tenants/[tenantId]/catalogue/menus/menu-manager-view";
import { AgentRunError } from "@/lib/agents/agent-runs";
import type { DraftProductEditorView } from "@/lib/catalogue/products";

const STORED = {
  schema: MENU_MANAGER_RESULT_SCHEMA,
  menuPublicId: "men_breakfast",
  summary: "Tighten the latte copy.",
  findings: [],
  suggestions: [
    {
      productPublicId: "prd_latte",
      field: "description_en" as const,
      proposedText: "A smooth espresso with steamed milk.",
      rationale: "The current line is generic.",
    },
    {
      productPublicId: "prd_latte",
      field: "name_ar" as const,
      proposedText: "لاتيه",
      rationale: "",
    },
  ],
  snapshot: { menuVersion: 4, sha256: "abc" },
};

const IDENTITY = {
  productPublicId: "prd_latte",
  field: "description_en" as const,
  proposedText: "A smooth espresso with steamed milk.",
};

function product(overrides: Partial<DraftProductEditorView> = {}): DraftProductEditorView {
  return {
    publicId: "prd_latte",
    internalName: "latte",
    status: "draft",
    version: 3,
    sku: null,
    barcode: null,
    primaryMediaAssetId: null,
    nutritionCalories: null,
    provenance: "operator_entered",
    businessProfile: "hospitality",
    canEditPrice: true,
    translations: {
      en: { displayName: "Latte", description: "Coffee.", translationVersion: 2, approvalStatus: "draft" },
      ar: { displayName: "لاتيه قديم", description: "قهوة", translationVersion: 5, approvalStatus: "draft" },
    },
    defaultVariant: { publicId: "var_latte_default", amountMinor: 1800, currency: "AED" },
    variants: [],
    ...overrides,
  };
}

describe("matchStoredSuggestion", () => {
  it("returns the stored suggestion only when product, field and text all match", () => {
    expect(matchStoredSuggestion(STORED, IDENTITY)).toEqual(STORED.suggestions[0]);
    expect(
      matchStoredSuggestion(STORED, { ...IDENTITY, proposedText: "A different line." }),
    ).toBeNull();
    expect(matchStoredSuggestion(STORED, { ...IDENTITY, field: "description_ar" })).toBeNull();
    expect(matchStoredSuggestion(STORED, { ...IDENTITY, productPublicId: "prd_gone" })).toBeNull();
    expect(matchStoredSuggestion({ suggestions: "nope" }, IDENTITY)).toBeNull();
  });
});

describe("reviewedMenuVersionFromStoredResult", () => {
  it("uses snapshot.menuVersion as the single source of truth for UI and server checks", () => {
    const stored = { ...STORED, menuVersion: 99 };
    expect(reviewedMenuVersionFromStoredResult(stored)).toBe(4);
    expect(readMenuManagerResult(stored)?.menuVersion).toBe(4);
    expect(
      assertSuggestionAcceptable({
        runStatus: "completed",
        storedResult: stored,
        currentMenuVersion: 4,
        identity: IDENTITY,
      }),
    ).toEqual(STORED.suggestions[0]);
    expect(() =>
      assertSuggestionAcceptable({
        runStatus: "completed",
        storedResult: stored,
        currentMenuVersion: 99,
        identity: IDENTITY,
      }),
    ).toThrow(expect.objectContaining({ code: "review_outdated" }));
  });
});

describe("assertSuggestionAcceptable", () => {
  it("accepts a completed run whose snapshot still matches the current menu draft", () => {
    expect(
      assertSuggestionAcceptable({
        runStatus: "completed",
        storedResult: STORED,
        currentMenuVersion: 4,
        identity: IDENTITY,
      }),
    ).toEqual(STORED.suggestions[0]);
  });

  it("rejects anything other than a completed run", () => {
    expect(() =>
      assertSuggestionAcceptable({
        runStatus: "running",
        storedResult: STORED,
        currentMenuVersion: 4,
        identity: IDENTITY,
      }),
    ).toThrow(AgentRunError);
    try {
      assertSuggestionAcceptable({
        runStatus: "failed",
        storedResult: STORED,
        currentMenuVersion: 4,
        identity: IDENTITY,
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "run_not_completed", statusCode: 409 });
    }
  });

  it("rejects a suggestion that is not on the stored result", () => {
    expect(() =>
      assertSuggestionAcceptable({
        runStatus: "completed",
        storedResult: STORED,
        currentMenuVersion: 4,
        identity: { ...IDENTITY, proposedText: "Not in the review." },
      }),
    ).toThrow(expect.objectContaining({ code: "suggestion_not_found", statusCode: 404 }));
  });

  it("rejects a review taken against a different or unknown menu version", () => {
    expect(() =>
      assertSuggestionAcceptable({
        runStatus: "completed",
        storedResult: STORED,
        currentMenuVersion: 5,
        identity: IDENTITY,
      }),
    ).toThrow(expect.objectContaining({ code: "review_outdated", statusCode: 409 }));

    expect(() =>
      assertSuggestionAcceptable({
        runStatus: "completed",
        storedResult: { ...STORED, snapshot: { menuVersion: null, sha256: "abc" } },
        currentMenuVersion: 4,
        identity: IDENTITY,
      }),
    ).toThrow(expect.objectContaining({ code: "review_outdated", statusCode: 409 }));
  });
});

describe("draftPatchForSuggestion", () => {
  it("maps one suggestion field onto the matching translation patch", () => {
    const current = product();
    expect(draftPatchForSuggestion("description_en", IDENTITY.proposedText, current)).toEqual({
      expectedVersion: 3,
      translations: {
        en: {
          description: IDENTITY.proposedText,
          expectedTranslationVersion: 2,
        },
      },
    });
    expect(draftPatchForSuggestion("name_en", "House latte", current)).toEqual({
      expectedVersion: 3,
      translations: {
        en: { displayName: "House latte", expectedTranslationVersion: 2 },
      },
    });
    expect(draftPatchForSuggestion("name_ar", "لاتيه", current)).toEqual({
      expectedVersion: 3,
      translations: {
        ar: { displayName: "لاتيه", expectedTranslationVersion: 5 },
      },
    });
    expect(draftPatchForSuggestion("description_ar", "حليب مبخر", current)).toEqual({
      expectedVersion: 3,
      translations: {
        ar: { description: "حليب مبخر", expectedTranslationVersion: 5 },
      },
    });
  });
});
