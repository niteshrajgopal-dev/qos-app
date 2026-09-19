import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  assertAllowedRemoteImageUrl,
  fetchRemoteImageBytes,
  RemoteImageFetchError,
} from "@/lib/media/remote-image-fetch";

async function createTestPng() {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  })
    .png()
    .toBuffer();
}

describe("remote image fetch", () => {
  it("accepts https URLs on public hosts", () => {
    expect(
      assertAllowedRemoteImageUrl(
        "https://media.finedinemenu.com/MawZBMZR_/example.jpeg",
      ),
    ).toBe("https://media.finedinemenu.com/MawZBMZR_/example.jpeg");
  });

  it("rejects non-https and private hosts", () => {
    expect(() =>
      assertAllowedRemoteImageUrl("http://media.finedinemenu.com/a.jpeg"),
    ).toThrow(RemoteImageFetchError);
    expect(() =>
      assertAllowedRemoteImageUrl("https://127.0.0.1/a.jpeg"),
    ).toThrow(RemoteImageFetchError);
    expect(() =>
      assertAllowedRemoteImageUrl("https://localhost/a.jpeg"),
    ).toThrow(RemoteImageFetchError);
  });

  it("fetches and validates remote image bytes", async () => {
    const pngBytes = await createTestPng();

    const result = await fetchRemoteImageBytes(
      "https://media.finedinemenu.com/example.png",
      {
        fetch: async () =>
          new Response(pngBytes, {
            status: 200,
            headers: {
              "content-type": "image/png",
              "content-length": String(pngBytes.byteLength),
            },
          }),
      },
    );

    expect(result.contentType).toBe("image/png");
    expect(result.bytes.byteLength).toBe(pngBytes.byteLength);
  });

  it("rejects oversize responses", async () => {
    const pngBytes = await createTestPng();

    await expect(
      fetchRemoteImageBytes("https://media.finedinemenu.com/example.png", {
        maxBytes: 16,
        fetch: async () =>
          new Response(pngBytes, {
            status: 200,
            headers: { "content-length": String(pngBytes.byteLength) },
          }),
      }),
    ).rejects.toThrow(/byte limit/i);
  });
});
