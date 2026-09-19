import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createAzureBlobMediaStorage } from "@/lib/media/azure-blob-storage";
import { readMediaConfig, type MediaConfig } from "@/lib/media/config";

export type MediaStorage = {
  writePrivate(relativePath: string, bytes: Buffer): Promise<void>;
  readPrivate(relativePath: string): Promise<Buffer>;
  writePublic(relativePath: string, bytes: Buffer): Promise<void>;
  readPublic(relativePath: string): Promise<Buffer>;
};

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly rootDirectory: string) {}

  private resolvePrivate(relativePath: string) {
    return path.join(this.rootDirectory, "private", relativePath);
  }

  private resolvePublic(relativePath: string) {
    return path.join(this.rootDirectory, "public", relativePath);
  }

  private async ensureParent(filePath: string) {
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  async writePrivate(relativePath: string, bytes: Buffer) {
    const target = this.resolvePrivate(relativePath);
    await this.ensureParent(target);
    await writeFile(target, bytes);
  }

  async readPrivate(relativePath: string) {
    return readFile(this.resolvePrivate(relativePath));
  }

  async writePublic(relativePath: string, bytes: Buffer) {
    const target = this.resolvePublic(relativePath);
    await this.ensureParent(target);
    await writeFile(target, bytes);
  }

  async readPublic(relativePath: string) {
    return readFile(this.resolvePublic(relativePath));
  }
}

export function createMediaStorage(
  config: MediaConfig,
  options?: { localRoot?: string },
): MediaStorage {
  if (config.storageBackend === "azure-blob") {
    if (!config.azureBlob) {
      throw new Error("Azure blob media config is missing.");
    }

    return createAzureBlobMediaStorage(config.azureBlob);
  }

  return new LocalMediaStorage(options?.localRoot ?? config.localRoot);
}

let storageInstance: MediaStorage | null = null;

export function getMediaStorage(rootDirectory?: string): MediaStorage {
  if (!storageInstance) {
    storageInstance = createMediaStorage(readMediaConfig(), {
      localRoot: rootDirectory,
    });
  }

  return storageInstance;
}

export function setMediaStorage(storage: MediaStorage | null) {
  storageInstance = storage;
}
