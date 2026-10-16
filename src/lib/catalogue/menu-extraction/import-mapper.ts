import type { MenuExtractionCandidatePayload } from "@/db/schema";
import type { NormalizedImportRow } from "@/lib/catalogue/catalogue-import-validation";
import { MENU_EXTRACTION_CONNECTION_KEY } from "@/lib/catalogue/menu-extraction/config";

function slugInternalName(candidateKey: string, displayNameEn: string | null) {
  const base = (displayNameEn ?? candidateKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || candidateKey.slice(0, 48);
}

export function stableMenuExtractionSourceId(sourcePublicId: string, candidateKey: string) {
  return `${MENU_EXTRACTION_CONNECTION_KEY}:${sourcePublicId}:${candidateKey}`;
}

export function candidateToImportRow(
  sourcePublicId: string,
  payload: MenuExtractionCandidatePayload,
  sourceRow: number,
): NormalizedImportRow | null {
  if (!payload.displayNameEn?.trim() || !payload.displayNameAr?.trim()) {
    return null;
  }
  if (payload.amountMinor == null || !payload.currency) {
    return null;
  }

  return {
    sourceRow,
    sourceId: stableMenuExtractionSourceId(sourcePublicId, payload.candidateKey),
    internalName: slugInternalName(payload.candidateKey, payload.displayNameEn),
    displayNameEn: payload.displayNameEn.trim(),
    displayNameAr: payload.displayNameAr.trim(),
    descriptionEn: payload.descriptionEn?.trim() || null,
    descriptionAr: payload.descriptionAr?.trim() || null,
    variantLabelEn: payload.variantLabelEn?.trim() || "Default",
    variantLabelAr: payload.variantLabelAr?.trim() || "افتراضي",
    amountMinor: payload.amountMinor,
    currency: payload.currency,
    sku: null,
    barcode: null,
    imageUrl: null,
  };
}
