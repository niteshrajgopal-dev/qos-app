import type { EnvSource } from "@/lib/env";

export const MENU_EXTRACTION_CONNECTION_KEY = "catalogue.menu_extraction";

export const MENU_EXTRACTION_LIMITS = {
  maxUploadBytes: 12 * 1024 * 1024,
  maxPages: 12,
  maxPixelDimension: 4096,
  allowedImageMimeTypes: ["image/jpeg", "image/png"] as const,
  allowedPdfMimeType: "application/pdf",
} as const;

export function readMenuExtractionConfig(source: EnvSource = process.env) {
  const maxUploadBytes = parsePositiveInt(source.MENU_EXTRACTION_MAX_UPLOAD_BYTES);
  const maxPages = parsePositiveInt(source.MENU_EXTRACTION_MAX_PAGES);
  const maxPixelDimension = parsePositiveInt(source.MENU_EXTRACTION_MAX_PIXEL_DIMENSION);
  return {
    maxUploadBytes: maxUploadBytes ?? MENU_EXTRACTION_LIMITS.maxUploadBytes,
    maxPages: maxPages ?? MENU_EXTRACTION_LIMITS.maxPages,
    maxPixelDimension: maxPixelDimension ?? MENU_EXTRACTION_LIMITS.maxPixelDimension,
  };
}

function parsePositiveInt(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
