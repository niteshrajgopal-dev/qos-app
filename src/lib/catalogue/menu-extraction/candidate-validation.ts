import { z } from "zod";

import type { MenuExtractionCandidatePayload } from "@/db/schema";
import { parseMenuExtractionPriceText } from "@/lib/catalogue/menu-extraction/candidate-price";
import { menuExtractionModelItemZod } from "@/lib/catalogue/menu-extraction/result";

export const menuExtractionCandidatePayloadZod = menuExtractionModelItemZod.extend({
  schema: z.literal("qos.catalogue_menu_extraction_candidate.v1"),
});

export class MenuExtractionCandidateValidationError extends Error {
  readonly statusCode = 400;
  readonly field: string;
  readonly candidateKey?: string;

  constructor(message: string, field: string, candidateKey?: string) {
    super(message);
    this.name = "MenuExtractionCandidateValidationError";
    this.field = field;
    this.candidateKey = candidateKey;
  }
}

function assertNonNegativeAmountMinor(amountMinor: number, candidateKey: string) {
  if (amountMinor < 0) {
    throw new MenuExtractionCandidateValidationError(
      "Price must be zero or greater.",
      "amountMinor",
      candidateKey,
    );
  }
}

function syncPriceFromText(
  candidateKey: string,
  priceText: string | null,
  amountMinor: number | null,
  currency: string | null,
): { amountMinor: number | null; currency: string | null } {
  if (!priceText?.trim()) {
    if (amountMinor != null) {
      assertNonNegativeAmountMinor(amountMinor, candidateKey);
    }
    return { amountMinor, currency };
  }

  const parsed = parseMenuExtractionPriceText(priceText);
  if (!parsed) {
    throw new MenuExtractionCandidateValidationError(
      "Price text could not be parsed.",
      "priceText",
      candidateKey,
    );
  }
  if (parsed.amountMinor < 0) {
    throw new MenuExtractionCandidateValidationError(
      "Price must be zero or greater.",
      "priceText",
      candidateKey,
    );
  }

  if (amountMinor != null && amountMinor !== parsed.amountMinor) {
    assertNonNegativeAmountMinor(amountMinor, candidateKey);
  }

  return { amountMinor: parsed.amountMinor, currency: parsed.currency };
}

export function parseMenuExtractionCandidatePayload(
  payload: unknown,
  candidateKey: string,
): MenuExtractionCandidatePayload {
  const parsed = menuExtractionCandidatePayloadZod.safeParse(payload);
  if (!parsed.success) {
    throw new MenuExtractionCandidateValidationError(
      "Candidate payload is invalid.",
      "payload",
      candidateKey,
    );
  }
  if (parsed.data.candidateKey !== candidateKey) {
    throw new MenuExtractionCandidateValidationError(
      "Candidate payload key does not match the row being updated.",
      "candidateKey",
      candidateKey,
    );
  }

  const synced = syncPriceFromText(
    candidateKey,
    parsed.data.priceText,
    parsed.data.amountMinor,
    parsed.data.currency,
  );

  if (synced.amountMinor === 0) {
    throw new MenuExtractionCandidateValidationError(
      "Price must be blank when unknown.",
      "amountMinor",
      candidateKey,
    );
  }

  if (synced.amountMinor != null) {
    assertNonNegativeAmountMinor(synced.amountMinor, candidateKey);
  }

  return {
    schema: "qos.catalogue_menu_extraction_candidate.v1",
    candidateKey: parsed.data.candidateKey,
    sectionName: parsed.data.sectionName,
    displayNameEn: parsed.data.displayNameEn,
    displayNameAr: parsed.data.displayNameAr,
    descriptionEn: parsed.data.descriptionEn,
    descriptionAr: parsed.data.descriptionAr,
    variantLabelEn: parsed.data.variantLabelEn,
    variantLabelAr: parsed.data.variantLabelAr,
    priceText: parsed.data.priceText,
    amountMinor: synced.amountMinor,
    currency: synced.amountMinor == null ? null : synced.currency,
    allergenText: parsed.data.allergenText,
    unitText: parsed.data.unitText,
    uncertainty: parsed.data.uncertainty,
    evidence: parsed.data.evidence,
    modelConfidenceEstimate: parsed.data.modelConfidenceEstimate,
  };
}

export type MenuExtractionConfirmFieldIssue = {
  field: "displayNameEn" | "displayNameAr" | "amountMinor" | "currency";
  message: string;
};

export function menuExtractionConfirmFieldIssues(
  payload: MenuExtractionCandidatePayload,
): MenuExtractionConfirmFieldIssue[] {
  const issues: MenuExtractionConfirmFieldIssue[] = [];
  if (!payload.displayNameEn?.trim()) {
    issues.push({ field: "displayNameEn", message: "English display name is required." });
  }
  if (!payload.displayNameAr?.trim()) {
    issues.push({ field: "displayNameAr", message: "Arabic display name is required." });
  }
  if (payload.amountMinor == null || !payload.currency) {
    issues.push({ field: "amountMinor", message: "Price is required before confirm." });
  }
  return issues;
}
