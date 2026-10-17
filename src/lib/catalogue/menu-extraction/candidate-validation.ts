import { z } from "zod";

import type { MenuExtractionCandidatePayload } from "@/db/schema";
import { menuExtractionModelItemZod } from "@/lib/catalogue/menu-extraction/result";

export const menuExtractionCandidatePayloadZod = menuExtractionModelItemZod.extend({
  schema: z.literal("qos.catalogue_menu_extraction_candidate.v1"),
});

export function parseMenuExtractionCandidatePayload(
  payload: unknown,
  candidateKey: string,
): MenuExtractionCandidatePayload {
  const parsed = menuExtractionCandidatePayloadZod.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Candidate payload is invalid.");
  }
  if (parsed.data.candidateKey !== candidateKey) {
    throw new Error("Candidate payload key does not match the row being updated.");
  }
  if (parsed.data.amountMinor === 0) {
    throw new Error("Price must be blank when unknown.");
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
    amountMinor: parsed.data.amountMinor,
    currency: parsed.data.currency,
    allergenText: parsed.data.allergenText,
    unitText: parsed.data.unitText,
    uncertainty: parsed.data.uncertainty,
    evidence: parsed.data.evidence,
    modelConfidenceEstimate: parsed.data.modelConfidenceEstimate,
  };
}
