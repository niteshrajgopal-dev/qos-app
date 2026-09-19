import { describe, expect, it } from "vitest";

import { readMediaConfig } from "@/lib/media/config";

describe("readMediaConfig storage backend", () => {
  it("defaults to local storage when MEDIA_STORAGE is unset", () => {
    const config = readMediaConfig({});

    expect(config.storageBackend).toBe("local");
    expect(config.localRoot).toBe(".local-media");
    expect(config.azureBlob).toBeUndefined();
  });

  it("accepts explicit local storage", () => {
    const config = readMediaConfig({
      MEDIA_STORAGE: "local",
      MEDIA_LOCAL_ROOT: "/tmp/media",
    });

    expect(config.storageBackend).toBe("local");
    expect(config.localRoot).toBe("/tmp/media");
  });

  it("requires an account URL or connection string for azure-blob storage", () => {
    expect(() =>
      readMediaConfig({
        MEDIA_STORAGE: "azure-blob",
      }),
    ).toThrow(/MEDIA_AZURE_BLOB_ACCOUNT_URL|MEDIA_AZURE_BLOB_CONNECTION_STRING/);
  });

  it("parses azure-blob Entra settings from an account URL", () => {
    const config = readMediaConfig({
      MEDIA_STORAGE: "azure-blob",
      MEDIA_AZURE_BLOB_ACCOUNT_URL: "https://qosmedia.blob.core.windows.net",
      MEDIA_AZURE_BLOB_PRIVATE_CONTAINER: "qos-media-private",
      MEDIA_AZURE_BLOB_PUBLIC_CONTAINER: "qos-media-public",
      MEDIA_AZURE_BLOB_PREFIX: "dev",
    });

    expect(config.storageBackend).toBe("azure-blob");
    expect(config.azureBlob).toEqual({
      authMode: "entra",
      accountUrl: "https://qosmedia.blob.core.windows.net",
      privateContainer: "qos-media-private",
      publicContainer: "qos-media-public",
      prefix: "dev",
    });
  });

  it("parses azure-blob storage settings", () => {
    const config = readMediaConfig({
      MEDIA_STORAGE: "azure-blob",
      MEDIA_AZURE_BLOB_CONNECTION_STRING:
        "DefaultEndpointsProtocol=https;AccountName=dev;AccountKey=key;EndpointSuffix=core.windows.net",
      MEDIA_AZURE_BLOB_PRIVATE_CONTAINER: "qos-media-private",
      MEDIA_AZURE_BLOB_PUBLIC_CONTAINER: "qos-media-public",
      MEDIA_AZURE_BLOB_PREFIX: "dev",
    });

    expect(config.storageBackend).toBe("azure-blob");
    expect(config.azureBlob).toEqual({
      authMode: "connection-string",
      connectionString:
        "DefaultEndpointsProtocol=https;AccountName=dev;AccountKey=key;EndpointSuffix=core.windows.net",
      privateContainer: "qos-media-private",
      publicContainer: "qos-media-public",
      prefix: "dev",
    });
  });

  it("prefers Entra account URL when both Azure settings are present", () => {
    const config = readMediaConfig({
      MEDIA_STORAGE: "azure-blob",
      MEDIA_AZURE_BLOB_ACCOUNT_URL: "https://qosmedia.blob.core.windows.net",
      MEDIA_AZURE_BLOB_CONNECTION_STRING:
        "DefaultEndpointsProtocol=https;AccountName=dev;AccountKey=key;EndpointSuffix=core.windows.net",
    });

    expect(config.azureBlob?.authMode).toBe("entra");
    expect(config.azureBlob?.accountUrl).toBe(
      "https://qosmedia.blob.core.windows.net",
    );
  });

  it("rejects unknown storage backends", () => {
    expect(() =>
      readMediaConfig({
        MEDIA_STORAGE: "s3",
      }),
    ).toThrow(/MEDIA_STORAGE must be "local" or "azure-blob"/);
  });
});
