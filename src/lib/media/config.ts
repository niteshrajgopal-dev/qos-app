import type { EnvSource } from "@/lib/env";

export type MediaStorageBackend = "local" | "azure-blob";

export type AzureBlobMediaConfig = {
  connectionString: string;
  privateContainer: string;
  publicContainer: string;
  prefix?: string;
};

export type MediaConfig = {
  maxUploadBytes: number;
  maxPixelDimension: number;
  grantTtlSeconds: number;
  localRoot: string;
  storageBackend: MediaStorageBackend;
  azureBlob?: AzureBlobMediaConfig;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseStorageBackend(value: string | undefined): MediaStorageBackend {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "local") {
    return "local";
  }

  if (normalized === "azure-blob") {
    return "azure-blob";
  }

  throw new Error(
    `MEDIA_STORAGE must be "local" or "azure-blob", got "${value}".`,
  );
}

export function readMediaConfig(source: EnvSource = process.env): MediaConfig {
  const storageBackend = parseStorageBackend(source.MEDIA_STORAGE);
  const base = {
    maxUploadBytes: parsePositiveInt(source.MEDIA_MAX_UPLOAD_BYTES, 5_000_000),
    maxPixelDimension: parsePositiveInt(source.MEDIA_MAX_PIXEL_DIMENSION, 4096),
    grantTtlSeconds: parsePositiveInt(source.MEDIA_UPLOAD_GRANT_TTL_SECONDS, 900),
    localRoot: source.MEDIA_LOCAL_ROOT?.trim() || ".local-media",
    storageBackend,
  };

  if (storageBackend !== "azure-blob") {
    return base;
  }

  const connectionString = source.MEDIA_AZURE_BLOB_CONNECTION_STRING?.trim();
  if (!connectionString) {
    throw new Error(
      "MEDIA_AZURE_BLOB_CONNECTION_STRING is required when MEDIA_STORAGE=azure-blob.",
    );
  }

  const prefix = source.MEDIA_AZURE_BLOB_PREFIX?.trim();

  return {
    ...base,
    azureBlob: {
      connectionString,
      privateContainer:
        source.MEDIA_AZURE_BLOB_PRIVATE_CONTAINER?.trim() || "media-private",
      publicContainer:
        source.MEDIA_AZURE_BLOB_PUBLIC_CONTAINER?.trim() || "media-public",
      prefix: prefix || undefined,
    },
  };
}
