import type { EnvSource } from "@/lib/env";

export type MediaConfig = {
  maxUploadBytes: number;
  maxPixelDimension: number;
  grantTtlSeconds: number;
  localRoot: string;
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

export function readMediaConfig(source: EnvSource = process.env): MediaConfig {
  return {
    maxUploadBytes: parsePositiveInt(source.MEDIA_MAX_UPLOAD_BYTES, 5_000_000),
    maxPixelDimension: parsePositiveInt(source.MEDIA_MAX_PIXEL_DIMENSION, 4096),
    grantTtlSeconds: parsePositiveInt(source.MEDIA_UPLOAD_GRANT_TTL_SECONDS, 900),
    localRoot: source.MEDIA_LOCAL_ROOT?.trim() || ".local-media",
  };
}
