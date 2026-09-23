import type { EnvSource } from "@/lib/env";

export type VideoProcessingConfig = {
  maxUploadBytes: number;
  maxDurationSeconds: number;
  maxWidth: number;
  maxHeight: number;
  allowedCodecs: string[];
  allowedContainers: string[];
  transcodeTargetCodec: string;
  transcodeTargetContainer: string;
  transcodeTargetMaxBitrate: string;
  posterTimestampRatio: number;
  maxConcurrentJobs: number;
  maxRetries: number;
  jobTimeoutMs: number;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseStringList(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Video processing configuration with bounded resource limits.
 * 
 * OWNER-LOCKED LIMITS (approved for production):
 * - Max file size: 20 MiB (20 * 1024 * 1024 = 20,971,520 bytes)
 * - Max duration: 25 seconds
 * - Max resolution: 1920x1080 (Full HD)
 * - Allowed codecs: h264, h265 (HEVC)
 * - Allowed containers: mp4, mov
 * 
 * These limits enforce bounded decode/transcode to prevent resource exhaustion.
 * Do not change these defaults without owner approval.
 */
export function readVideoProcessingConfig(source: EnvSource = process.env): VideoProcessingConfig {
  return {
    // 20 MiB owner-locked limit
    maxUploadBytes: parsePositiveInt(
      source.VIDEO_MAX_UPLOAD_BYTES,
      20 * 1024 * 1024,
    ),
    
    // 25 seconds owner-locked limit
    maxDurationSeconds: parsePositiveInt(
      source.VIDEO_MAX_DURATION_SECONDS,
      25,
    ),
    
    // Full HD resolution limits
    maxWidth: parsePositiveInt(source.VIDEO_MAX_WIDTH, 1920),
    maxHeight: parsePositiveInt(source.VIDEO_MAX_HEIGHT, 1080),
    
    // Approved codecs for input
    allowedCodecs: parseStringList(
      source.VIDEO_ALLOWED_CODECS,
      ["h264", "h265"],
    ),
    
    // Approved containers for input
    allowedContainers: parseStringList(
      source.VIDEO_ALLOWED_CONTAINERS,
      ["mp4", "mov"],
    ),
    
    // Transcode output settings
    transcodeTargetCodec: source.VIDEO_TRANSCODE_CODEC?.trim() || "libx264",
    transcodeTargetContainer: source.VIDEO_TRANSCODE_CONTAINER?.trim() || "mp4",
    transcodeTargetMaxBitrate: source.VIDEO_TRANSCODE_MAX_BITRATE?.trim() || "2M",
    
    // Poster generation: extract frame at 50% of video duration
    posterTimestampRatio: parsePositiveFloat(
      source.VIDEO_POSTER_TIMESTAMP_RATIO,
      0.5,
    ),
    
    // Worker concurrency and retry settings
    maxConcurrentJobs: parsePositiveInt(source.VIDEO_MAX_CONCURRENT_JOBS, 2),
    maxRetries: parsePositiveInt(source.VIDEO_MAX_RETRIES, 3),
    
    // Job timeout: 5 minutes default (generous for 30s video @ 25MB)
    jobTimeoutMs: parsePositiveInt(
      source.VIDEO_JOB_TIMEOUT_MS,
      5 * 60 * 1000,
    ),
  };
}
