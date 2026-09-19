import type { ContainerClient } from "@azure/storage-blob";

export type BlobContainerOps = {
  uploadBlob(blobName: string, data: Buffer): Promise<void>;
  downloadBlob(blobName: string): Promise<Buffer>;
};

export function createAzureBlobContainerOps(
  containerClient: ContainerClient,
): BlobContainerOps {
  return {
    async uploadBlob(blobName, data) {
      const blockBlob = containerClient.getBlockBlobClient(blobName);
      await blockBlob.uploadData(data);
    },
    async downloadBlob(blobName) {
      const blockBlob = containerClient.getBlockBlobClient(blobName);
      return blockBlob.downloadToBuffer();
    },
  };
}

export class InMemoryBlobContainer implements BlobContainerOps {
  private readonly blobs = new Map<string, Buffer>();

  async uploadBlob(blobName: string, data: Buffer) {
    this.blobs.set(blobName, Buffer.from(data));
  }

  async downloadBlob(blobName: string) {
    const bytes = this.blobs.get(blobName);
    if (!bytes) {
      const error = new Error(
        `Blob not found: ${blobName}`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    return Buffer.from(bytes);
  }
}
