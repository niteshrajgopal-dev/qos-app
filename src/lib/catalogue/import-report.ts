export const CATALOGUE_IMPORT_ERROR_CATEGORIES = [
  "finedine-http-413",
  "azure-auth",
  "pixel-limit",
  "other",
] as const;

export type CatalogueImportErrorCategory =
  (typeof CATALOGUE_IMPORT_ERROR_CATEGORIES)[number];

export type CatalogueImportMediaSummary = {
  uploaded: number;
  alreadyPresent: number;
  repaired: number;
};

export type CatalogueImportErrorSummary = Record<
  CatalogueImportErrorCategory,
  number
>;

const REQUEST_ID_PATTERN =
  /RequestId:\s*[a-f0-9-]+/gi;
const AZURE_TIME_PATTERN =
  /\bTime:\s*\d{4}-\d{2}-\d{2}T[^\s]+/gi;

export function normalizeImportErrorReason(reason: string | null | undefined) {
  if (!reason) {
    return "";
  }

  return reason
    .replace(REQUEST_ID_PATTERN, "RequestId:<redacted>")
    .replace(AZURE_TIME_PATTERN, "Time:<redacted>")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyCatalogueImportError(
  reason: string | null | undefined,
): CatalogueImportErrorCategory {
  const normalized = normalizeImportErrorReason(reason);

  if (
    /TooLargeImageException|HTTP 413|too large to return/i.test(normalized)
  ) {
    return "finedine-http-413";
  }

  if (
    /Key based authentication is not permitted|not permitted on this storage account|DefaultAzureCredential|ChainedTokenCredential|ManagedIdentityCredential/i.test(
      normalized,
    )
  ) {
    return "azure-auth";
  }

  if (/pixel limits/i.test(normalized)) {
    return "pixel-limit";
  }

  return "other";
}

export function summarizeCatalogueImportErrors(
  rows: Array<{ reason?: string | null }>,
): CatalogueImportErrorSummary {
  const summary: CatalogueImportErrorSummary = {
    "finedine-http-413": 0,
    "azure-auth": 0,
    "pixel-limit": 0,
    other: 0,
  };

  for (const row of rows) {
    summary[classifyCatalogueImportError(row.reason)] += 1;
  }

  return summary;
}

export function emptyCatalogueImportMediaSummary(): CatalogueImportMediaSummary {
  return {
    uploaded: 0,
    alreadyPresent: 0,
    repaired: 0,
  };
}

export function formatCatalogueImportCliReport(input: {
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  errorCount: number;
  media?: CatalogueImportMediaSummary;
  errorCategories?: CatalogueImportErrorSummary;
}) {
  const media = input.media ?? emptyCatalogueImportMediaSummary();
  const errors =
    input.errorCategories ??
    ({
      "finedine-http-413": 0,
      "azure-auth": 0,
      "pixel-limit": 0,
      other: 0,
    } satisfies CatalogueImportErrorSummary);

  return [
    `  Import summary: created=${input.createCount}, updated=${input.updateCount}, unchanged=${input.unchangedCount}, errors=${input.errorCount}`,
    "  Media:",
    `    uploaded: ${media.uploaded}`,
    `    already-present: ${media.alreadyPresent}`,
    `    repaired: ${media.repaired}`,
    "  Errors:",
    `    finedine-http-413: ${errors["finedine-http-413"]}`,
    `    azure-auth: ${errors["azure-auth"]}`,
    `    pixel-limit: ${errors["pixel-limit"]}`,
    `    other: ${errors.other}`,
  ].join("\n");
}
