import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AzureBlobMediaStorage } from "@/lib/media/azure-blob-storage";
import { InMemoryBlobContainer } from "@/lib/media/blob-container";
import { readMediaConfig } from "@/lib/media/config";
import {
  createMediaStorage,
  LocalMediaStorage,
  type MediaStorage,
} from "@/lib/media/storage";

const sampleBytes = Buffer.from("sample-image-bytes");
const privateRelativePath = "tenant-1/quarantine/mas_abc123/original";
const publicRelativePath = "tenant-1/public/mda_def456.jpg";

async function exerciseMediaStorage(storage: MediaStorage) {
  await storage.writePrivate(privateRelativePath, sampleBytes);
  await storage.writePublic(publicRelativePath, sampleBytes);

  expect((await storage.readPrivate(privateRelativePath)).equals(sampleBytes)).toBe(
    true,
  );
  expect((await storage.readPublic(publicRelativePath)).equals(sampleBytes)).toBe(
    true,
  );
}

describe("LocalMediaStorage", () => {
  let tempMediaRoot: string;

  afterEach(async () => {
    if (tempMediaRoot) {
      await rm(tempMediaRoot, { recursive: true, force: true });
    }
  });

  it("stores private and public files under the configured root", async () => {
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-local-media-"));
    const storage = new LocalMediaStorage(tempMediaRoot);

    await exerciseMediaStorage(storage);

    const privateFile = path.join(
      tempMediaRoot,
      "private",
      privateRelativePath,
    );
    const publicFile = path.join(tempMediaRoot, "public", publicRelativePath);

    expect((await readFile(privateFile)).equals(sampleBytes)).toBe(true);
    expect((await readFile(publicFile)).equals(sampleBytes)).toBe(true);
  });
});

describe("AzureBlobMediaStorage", () => {
  it("maps private and public paths to separate in-memory containers", async () => {
    const privateContainer = new InMemoryBlobContainer();
    const publicContainer = new InMemoryBlobContainer();
    const storage = new AzureBlobMediaStorage(
      privateContainer,
      publicContainer,
      "prod",
    );

    await exerciseMediaStorage(storage);

    await expect(
      privateContainer.downloadBlob(`prod/private/${privateRelativePath}`),
    ).resolves.toEqual(sampleBytes);
    await expect(
      publicContainer.downloadBlob(`prod/public/${publicRelativePath}`),
    ).resolves.toEqual(sampleBytes);
  });

  it("throws ENOENT when a blob is missing", async () => {
    const storage = new AzureBlobMediaStorage(
      new InMemoryBlobContainer(),
      new InMemoryBlobContainer(),
    );

    await expect(storage.readPublic("missing/file.jpg")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("createMediaStorage", () => {
  it("defaults to local storage from config", () => {
    const storage = createMediaStorage(readMediaConfig({}), {
      localRoot: "/tmp/custom-media",
    });

    expect(storage).toBeInstanceOf(LocalMediaStorage);
  });

  it("creates azure blob storage when configured", () => {
    const storage = createMediaStorage(
      readMediaConfig({
        MEDIA_STORAGE: "azure-blob",
        MEDIA_AZURE_BLOB_CONNECTION_STRING:
          "DefaultEndpointsProtocol=https;AccountName=dev;AccountKey=key;EndpointSuffix=core.windows.net",
      }),
    );

    expect(storage).toBeInstanceOf(AzureBlobMediaStorage);
  });
});
