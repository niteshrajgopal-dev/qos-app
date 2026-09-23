import { describe, expect, it } from "vitest";

import { readVideoProcessingConfig } from "@/lib/media/video-config";

describe("readVideoProcessingConfig", () => {
  it("uses working defaults when env vars are unset", () => {
    const config = readVideoProcessingConfig({});

    expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(config.maxDurationSeconds).toBe(30);
    expect(config.maxWidth).toBe(1920);
    expect(config.maxHeight).toBe(1080);
    expect(config.allowedCodecs).toEqual(["h264", "h265"]);
    expect(config.allowedContainers).toEqual(["mp4", "mov"]);
    expect(config.transcodeTargetCodec).toBe("libx264");
    expect(config.transcodeTargetContainer).toBe("mp4");
    expect(config.transcodeTargetMaxBitrate).toBe("2M");
    expect(config.posterTimestampRatio).toBe(0.5);
    expect(config.maxConcurrentJobs).toBe(2);
    expect(config.maxRetries).toBe(3);
    expect(config.jobTimeoutMs).toBe(5 * 60 * 1000);
  });

  it("parses custom byte limits", () => {
    const config = readVideoProcessingConfig({
      VIDEO_MAX_UPLOAD_BYTES: "50000000",
    });

    expect(config.maxUploadBytes).toBe(50_000_000);
  });

  it("parses custom duration limits", () => {
    const config = readVideoProcessingConfig({
      VIDEO_MAX_DURATION_SECONDS: "60",
    });

    expect(config.maxDurationSeconds).toBe(60);
  });

  it("parses custom resolution limits", () => {
    const config = readVideoProcessingConfig({
      VIDEO_MAX_WIDTH: "3840",
      VIDEO_MAX_HEIGHT: "2160",
    });

    expect(config.maxWidth).toBe(3840);
    expect(config.maxHeight).toBe(2160);
  });

  it("parses custom codec lists", () => {
    const config = readVideoProcessingConfig({
      VIDEO_ALLOWED_CODECS: "h264,vp9",
      VIDEO_ALLOWED_CONTAINERS: "mp4,webm",
    });

    expect(config.allowedCodecs).toEqual(["h264", "vp9"]);
    expect(config.allowedContainers).toEqual(["mp4", "webm"]);
  });

  it("parses custom transcode settings", () => {
    const config = readVideoProcessingConfig({
      VIDEO_TRANSCODE_CODEC: "libx265",
      VIDEO_TRANSCODE_CONTAINER: "mov",
      VIDEO_TRANSCODE_MAX_BITRATE: "4M",
    });

    expect(config.transcodeTargetCodec).toBe("libx265");
    expect(config.transcodeTargetContainer).toBe("mov");
    expect(config.transcodeTargetMaxBitrate).toBe("4M");
  });

  it("falls back to defaults for invalid integers", () => {
    const config = readVideoProcessingConfig({
      VIDEO_MAX_UPLOAD_BYTES: "not-a-number",
      VIDEO_MAX_DURATION_SECONDS: "-10",
      VIDEO_MAX_WIDTH: "0",
    });

    expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(config.maxDurationSeconds).toBe(30);
    expect(config.maxWidth).toBe(1920);
  });

  it("falls back to defaults for invalid floats", () => {
    const config = readVideoProcessingConfig({
      VIDEO_POSTER_TIMESTAMP_RATIO: "invalid",
    });

    expect(config.posterTimestampRatio).toBe(0.5);
  });

  it("handles empty codec lists", () => {
    const config = readVideoProcessingConfig({
      VIDEO_ALLOWED_CODECS: "",
    });

    expect(config.allowedCodecs).toEqual(["h264", "h265"]);
  });
});
