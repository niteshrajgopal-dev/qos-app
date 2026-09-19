import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

import type { AzureBlobMediaConfig } from "@/lib/media/config";
import {
  createAzureBlobContainerOps,
  type BlobContainerOps,
} from "@/lib/media/blob-container";
import type { MediaStorage } from "@/lib/media/storage";

function joinBlobPath(...segments: Array<string | undefined>) {
  return segments
    .flatMap((segment) => segment?.split("/") ?? [])
    .filter((segment) => segment.length > 0)
    .join("/");
}

export class AzureBlobMediaStorage implements MediaStorage {
  constructor(
    private readonly privateContainer: BlobContainerOps,
    private readonly publicContainer: BlobContainerOps,
    private readonly prefix?: string,
  ) {}

  private resolvePrivateBlobName(relativePath: string) {
    return joinBlobPath(this.prefix, "private", relativePath);
  }

  private resolvePublicBlobName(relativePath: string) {
    return joinBlobPath(this.prefix, "public", relativePath);
  }

  async writePrivate(relativePath: string, bytes: Buffer) {
    await this.privateContainer.uploadBlob(
      this.resolvePrivateBlobName(relativePath),
      bytes,
    );
  }

  async readPrivate(relativePath: string) {
    return this.privateContainer.downloadBlob(
      this.resolvePrivateBlobName(relativePath),
    );
  }

  async writePublic(relativePath: string, bytes: Buffer) {
    await this.publicContainer.uploadBlob(
      this.resolvePublicBlobName(relativePath),
      bytes,
    );
  }

  async readPublic(relativePath: string) {
    return this.publicContainer.downloadBlob(
      this.resolvePublicBlobName(relativePath),
    );
  }
}

export function createAzureBlobServiceClient(
  config: AzureBlobMediaConfig,
  deps: {
    createCredential?: () => TokenCredential;
  } = {},
) {
  if (config.authMode === "entra") {
    if (!config.accountUrl) {
      throw new Error(
        "MEDIA_AZURE_BLOB_ACCOUNT_URL is required when using Entra ID / Managed Identity.",
      );
    }

    const createCredential =
      deps.createCredential ?? (() => new DefaultAzureCredential());
    return new BlobServiceClient(config.accountUrl, createCredential());
  }

  if (!config.connectionString) {
    throw new Error(
      "MEDIA_AZURE_BLOB_CONNECTION_STRING is required when using shared-key Azure Blob authentication.",
    );
  }

  return BlobServiceClient.fromConnectionString(config.connectionString);
}

export function createAzureBlobMediaStorage(
  config: AzureBlobMediaConfig,
  containers?: {
    privateContainer: BlobContainerOps;
    publicContainer: BlobContainerOps;
  },
): AzureBlobMediaStorage {
  if (containers) {
    return new AzureBlobMediaStorage(
      containers.privateContainer,
      containers.publicContainer,
      config.prefix,
    );
  }

  const serviceClient = createAzureBlobServiceClient(config);

  return new AzureBlobMediaStorage(
    createAzureBlobContainerOps(
      serviceClient.getContainerClient(config.privateContainer),
    ),
    createAzureBlobContainerOps(
      serviceClient.getContainerClient(config.publicContainer),
    ),
    config.prefix,
  );
}
