import type { EnvSource } from "@/lib/env";

export type MediaStorageBackend = "local" | "azure-blob";

export type AzureBlobAuthMode = "entra" | "connection-string";

export type AzureBlobMediaConfig = {
  authMode: AzureBlobAuthMode;
  accountUrl?: string;
  connectionString?: string;
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

function parseAzureAccountUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "MEDIA_AZURE_BLOB_ACCOUNT_URL must be a valid https blob endpoint such as https://<account>.blob.core.windows.net.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      "MEDIA_AZURE_BLOB_ACCOUNT_URL must use https.",
    );
  }

  return parsed.origin;
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

  const accountUrlValue = source.MEDIA_AZURE_BLOB_ACCOUNT_URL?.trim();
  const connectionString = source.MEDIA_AZURE_BLOB_CONNECTION_STRING?.trim();
  const sharedContainer = source.MEDIA_AZURE_BLOB_CONTAINER?.trim();
  const prefix = source.MEDIA_AZURE_BLOB_PREFIX?.trim();
  const privateContainer =
    source.MEDIA_AZURE_BLOB_PRIVATE_CONTAINER?.trim() ||
    sharedContainer ||
    "media-private";
  const publicContainer =
    source.MEDIA_AZURE_BLOB_PUBLIC_CONTAINER?.trim() ||
    sharedContainer ||
    "media-public";

  if (accountUrlValue) {
    return {
      ...base,
      azureBlob: {
        authMode: "entra",
        accountUrl: parseAzureAccountUrl(accountUrlValue),
        privateContainer,
        publicContainer,
        prefix: prefix || undefined,
      },
    };
  }

  if (connectionString) {
    return {
      ...base,
      azureBlob: {
        authMode: "connection-string",
        connectionString,
        privateContainer,
        publicContainer,
        prefix: prefix || undefined,
      },
    };
  }

  throw new Error(
    "Azure Blob storage requires MEDIA_AZURE_BLOB_ACCOUNT_URL (Entra ID / Managed Identity) or MEDIA_AZURE_BLOB_CONNECTION_STRING (shared key, development only).",
  );
}
