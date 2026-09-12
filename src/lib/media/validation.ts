import sharp, { type Metadata } from "sharp";

import { readMediaConfig } from "@/lib/media/config";

export class MediaValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "MediaValidationError";
    this.field = field;
  }
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function startsWithBuffer(source: Buffer, prefix: Buffer) {
  return source.subarray(0, prefix.length).equals(prefix);
}

export function detectImageContentType(bytes: Buffer) {
  if (startsWithBuffer(bytes, JPEG_MAGIC)) {
    return "image/jpeg";
  }

  if (startsWithBuffer(bytes, PNG_MAGIC)) {
    return "image/png";
  }

  return null;
}

export async function validateImageBytes(
  bytes: Buffer,
  expectedContentType: string,
) {
  const config = readMediaConfig();

  if (bytes.byteLength === 0) {
    throw new MediaValidationError("Uploaded image is empty.", "body");
  }

  if (bytes.byteLength > config.maxUploadBytes) {
    throw new MediaValidationError(
      "Uploaded image exceeds the configured byte limit.",
      "body",
    );
  }

  const detectedContentType = detectImageContentType(bytes);
  if (!detectedContentType) {
    throw new MediaValidationError(
      "Only JPEG and PNG uploads are supported.",
      "contentType",
    );
  }

  if (detectedContentType !== expectedContentType) {
    throw new MediaValidationError(
      "Uploaded bytes do not match the declared content type.",
      "contentType",
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata();
  } catch {
    throw new MediaValidationError("Uploaded image is corrupt or unreadable.", "body");
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (
    width <= 0 ||
    height <= 0 ||
    width > config.maxPixelDimension ||
    height > config.maxPixelDimension
  ) {
    throw new MediaValidationError(
      "Uploaded image exceeds the configured pixel limits.",
      "body",
    );
  }

  return {
    contentType: detectedContentType,
    width,
    height,
  };
}

export async function generateImageDerivatives(bytes: Buffer) {
  const thumbnail = await sharp(bytes)
    .rotate()
    .resize({ width: 256, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const display = await sharp(bytes)
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    thumbnail: {
      bytes: thumbnail.data,
      width: thumbnail.info.width,
      height: thumbnail.info.height,
      contentType: "image/jpeg",
    },
    display: {
      bytes: display.data,
      width: display.info.width,
      height: display.info.height,
      contentType: "image/jpeg",
    },
  };
}
