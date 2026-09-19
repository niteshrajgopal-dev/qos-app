import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

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

  it("classifies FineDine HTTP 413 TooLargeImageException", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            status: 413,
            code: "TooLargeImageException",
            message: "The converted image is too large to return.",
          }),
          {
            status: 413,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    await expect(
      fetchRemoteImageBytes(
        "https://media.finedinemenu.com/MawZBMZR_/e83f3fcf-98eb-47a3-9e05-80097b6127ae.jpeg",
        { fetch: fetchImpl },
      ),
    ).rejects.toMatchObject({
      name: "RemoteImageFetchError",
      statusCode: 413,
      code: "TooLargeImageException",
    });

    const requestedUrls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(new Set(requestedUrls).size).toBe(requestedUrls.length);
    expect(requestedUrls.every((url) => url.includes("fit-in/"))).toBe(true);
  });

  it("uses a smaller FineDine rendition when the original would be too large", async () => {
    const pngBytes = await createTestPng();
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("fit-in/1600x1600/")) {
        return new Response(pngBytes, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(pngBytes.byteLength),
          },
        });
      }

      return new Response(
        JSON.stringify({
          status: 413,
          code: "TooLargeImageException",
          message: "The converted image is too large to return.",
        }),
        {
          status: 413,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await fetchRemoteImageBytes(
      "https://media.finedinemenu.com/MawZBMZR_/e83f3fcf-98eb-47a3-9e05-80097b6127ae.jpeg",
      { fetch: fetchImpl },
    );

    expect(result.contentType).toBe("image/png");
    expect(result.bytes.equals(pngBytes)).toBe(true);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("fit-in/1600x1600/");
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
