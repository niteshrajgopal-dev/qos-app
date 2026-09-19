import sharp from "sharp";

import { readMediaConfig } from "@/lib/media/config";
import {
  detectImageContentType,
  MediaValidationError,
  validateImageBytes,
} from "@/lib/media/validation";

export type PreparedImportedImage = {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  resized: boolean;
};

const SHARP_DECODE_OPTIONS = {
  failOn: "error" as const,
};

export async function prepareImportedImageBytes(
  bytes: Buffer,
  options: {
    maxPixelDimension?: number;
    maxUploadBytes?: number;
  } = {},
): Promise<PreparedImportedImage> {
  const config = readMediaConfig();
  const maxPixelDimension = options.maxPixelDimension ?? config.maxPixelDimension;
  const maxUploadBytes = options.maxUploadBytes ?? config.maxUploadBytes;

  if (bytes.byteLength === 0) {
    throw new MediaValidationError("Uploaded image is empty.", "body");
  }

  if (bytes.byteLength > maxUploadBytes) {
    throw new MediaValidationError(
      "Uploaded image exceeds the configured byte limit.",
      "body",
    );
  }

  const detectedContentType = detectImageContentType(bytes);
  if (
    detectedContentType !== "image/jpeg" &&
    detectedContentType !== "image/png"
  ) {
    throw new MediaValidationError(
      "Only JPEG and PNG uploads are supported.",
      "contentType",
    );
  }

  let metadata;
  try {
    metadata = await sharp(bytes, SHARP_DECODE_OPTIONS).metadata();
  } catch {
    throw new MediaValidationError(
      "Uploaded image is corrupt or unreadable.",
      "body",
    );
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new MediaValidationError(
      "Uploaded image is corrupt or unreadable.",
      "body",
    );
  }

  if (width <= maxPixelDimension && height <= maxPixelDimension) {
    const validated = await validateImageBytes(bytes, detectedContentType);
    return {
      bytes,
      contentType: detectedContentType,
      width: validated.width,
      height: validated.height,
      resized: false,
    };
  }

  const resizedPipeline = sharp(bytes, SHARP_DECODE_OPTIONS)
    .rotate()
    .resize({
      width: maxPixelDimension,
      height: maxPixelDimension,
      fit: "inside",
      withoutEnlargement: true,
    });

  const resized =
    detectedContentType === "image/jpeg"
      ? await resizedPipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
      : await resizedPipeline.png({ compressionLevel: 9 }).toBuffer();

  const validated = await validateImageBytes(resized, detectedContentType);
  return {
    bytes: resized,
    contentType: detectedContentType,
    width: validated.width,
    height: validated.height,
    resized: true,
  };
}
