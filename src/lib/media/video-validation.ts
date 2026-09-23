import { spawn } from "node:child_process";

import { readVideoProcessingConfig } from "@/lib/media/video-config";

export class VideoValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "VideoValidationError";
    this.field = field;
  }
}

const MP4_MAGIC = Buffer.from([0x00, 0x00, 0x00]);
const FTYP = Buffer.from("ftyp", "ascii");

function startsWithBuffer(source: Buffer, prefix: Buffer): boolean {
  return source.subarray(0, prefix.length).equals(prefix);
}

/**
 * Detect video/mp4 by checking for MP4 container magic bytes.
 * MP4 files start with a size field (4 bytes) followed by "ftyp".
 */
export function detectVideoContentType(bytes: Buffer): string | null {
  if (bytes.length < 12) {
    return null;
  }

  if (startsWithBuffer(bytes, MP4_MAGIC)) {
    const brandSlice = bytes.subarray(4, 8);
    if (brandSlice.equals(FTYP)) {
      return "video/mp4";
    }
  }

  return null;
}

export type VideoMetadata = {
  contentType: string;
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec?: string;
  bitrate: number;
};

/**
 * Probe video metadata using ffprobe with bounded resource limits.
 * 
 * This function validates:
 * - File size within configured limit
 * - Duration within configured limit
 * - Resolution within configured limit
 * - Codec is in allowed list
 * - Container format is in allowed list
 * 
 * Throws VideoValidationError if any constraint is violated.
 */
export async function validateVideoBytes(
  bytes: Buffer,
  expectedContentType: string,
): Promise<VideoMetadata> {
  const config = readVideoProcessingConfig();

  if (bytes.byteLength === 0) {
    throw new VideoValidationError("Uploaded video is empty.", "body");
  }

  if (bytes.byteLength > config.maxUploadBytes) {
    const maxMiB = (config.maxUploadBytes / (1024 * 1024)).toFixed(0);
    throw new VideoValidationError(
      `Uploaded video exceeds the owner-locked byte limit (${maxMiB} MiB).`,
      "body",
    );
  }

  const detectedContentType = detectVideoContentType(bytes);
  if (!detectedContentType) {
    throw new VideoValidationError(
      "Only MP4 video uploads are supported.",
      "contentType",
    );
  }

  if (detectedContentType !== expectedContentType) {
    throw new VideoValidationError(
      "Uploaded bytes do not match the declared content type.",
      "contentType",
    );
  }

  let probeResult: string;
  try {
    probeResult = await new Promise((resolve, reject) => {
      const ffprobe = spawn("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name,bit_rate",
        "-show_entries",
        "stream=codec_name,codec_type,width,height",
        "-of",
        "json",
        "-i",
        "-",
      ]);

      let stdout = "";
      let stderr = "";

      ffprobe.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ffprobe.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ffprobe.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      ffprobe.stdin.write(bytes);
      ffprobe.stdin.end();

      setTimeout(() => {
        ffprobe.kill();
        reject(new Error("ffprobe timeout"));
      }, 30000);
    });
  } catch (error) {
    throw new VideoValidationError(
      `Failed to probe video metadata: ${error instanceof Error ? error.message : "unknown error"}`,
      "body",
    );
  }

  let probe: {
    format?: {
      duration?: string;
      format_name?: string;
      bit_rate?: string;
    };
    streams?: Array<{
      codec_name?: string;
      codec_type?: string;
      width?: number;
      height?: number;
    }>;
  };

  try {
    probe = JSON.parse(probeResult);
  } catch {
    throw new VideoValidationError("Failed to parse ffprobe output.", "body");
  }

  if (!probe.format || !probe.streams) {
    throw new VideoValidationError("Video format or streams missing.", "body");
  }

  const durationSeconds = Number.parseFloat(probe.format.duration || "0");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new VideoValidationError("Video duration is invalid or zero.", "body");
  }

  if (durationSeconds > config.maxDurationSeconds) {
    throw new VideoValidationError(
      `Video duration (${durationSeconds.toFixed(1)}s) exceeds the owner-locked limit (${config.maxDurationSeconds}s).`,
      "body",
    );
  }

  const formatName = probe.format.format_name || "";
  const containerMatch = config.allowedContainers.some((allowed) =>
    formatName.includes(allowed),
  );
  if (!containerMatch) {
    throw new VideoValidationError(
      `Video container format "${formatName}" is not allowed. Allowed: ${config.allowedContainers.join(", ")}.`,
      "body",
    );
  }

  const videoStream = probe.streams.find((s) => s.codec_type === "video");
  if (!videoStream) {
    throw new VideoValidationError("No video stream found.", "body");
  }

  const videoCodec = videoStream.codec_name || "";
  if (!config.allowedCodecs.includes(videoCodec)) {
    throw new VideoValidationError(
      `Video codec "${videoCodec}" is not allowed. Allowed: ${config.allowedCodecs.join(", ")}.`,
      "body",
    );
  }

  const width = videoStream.width || 0;
  const height = videoStream.height || 0;

  if (
    width <= 0 ||
    height <= 0 ||
    width > config.maxWidth ||
    height > config.maxHeight
  ) {
    throw new VideoValidationError(
      `Video resolution (${width}x${height}) exceeds the owner-locked limits (${config.maxWidth}x${config.maxHeight}).`,
      "body",
    );
  }

  const audioStream = probe.streams.find((s) => s.codec_type === "audio");
  const audioCodec = audioStream?.codec_name;

  const bitrate = Number.parseInt(probe.format.bit_rate || "0", 10);

  return {
    contentType: detectedContentType,
    durationSeconds,
    width,
    height,
    videoCodec,
    audioCodec,
    bitrate,
  };
}

/**
 * Extract a poster frame from video at the specified timestamp ratio.
 * 
 * Returns JPEG bytes suitable for use as a thumbnail or poster image.
 */
export async function extractPosterFrame(
  videoBytes: Buffer,
  durationSeconds: number,
): Promise<Buffer> {
  const config = readVideoProcessingConfig();
  const timestamp = durationSeconds * config.posterTimestampRatio;

  try {
    const result = await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-ss",
        timestamp.toString(),
        "-i",
        "-",
        "-vframes",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-",
      ]);

      const chunks: Buffer[] = [];
      let stderr = "";

      ffmpeg.stdout.on("data", (data) => {
        chunks.push(data);
      });

      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      ffmpeg.stdin.write(videoBytes);
      ffmpeg.stdin.end();

      setTimeout(() => {
        ffmpeg.kill();
        reject(new Error("ffmpeg timeout"));
      }, 30000);
    });

    if (!result || result.length === 0) {
      throw new Error("ffmpeg returned empty output");
    }

    return result;
  } catch (error) {
    throw new VideoValidationError(
      `Failed to extract poster frame: ${error instanceof Error ? error.message : "unknown error"}`,
      "body",
    );
  }
}

/**
 * Transcode video to approved playback format with bounded bitrate.
 * 
 * Returns transcoded video bytes.
 */
export async function transcodeVideo(videoBytes: Buffer): Promise<Buffer> {
  const config = readVideoProcessingConfig();

  try {
    const result = await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i",
        "-",
        "-c:v",
        config.transcodeTargetCodec,
        "-b:v",
        config.transcodeTargetMaxBitrate,
        "-preset",
        "fast",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        config.transcodeTargetContainer,
        "-",
      ]);

      const chunks: Buffer[] = [];
      let stderr = "";

      ffmpeg.stdout.on("data", (data) => {
        chunks.push(data);
      });

      ffmpeg.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      ffmpeg.stdin.write(videoBytes);
      ffmpeg.stdin.end();

      setTimeout(() => {
        ffmpeg.kill();
        reject(new Error("ffmpeg timeout"));
      }, config.jobTimeoutMs);
    });

    if (!result || result.length === 0) {
      throw new Error("ffmpeg returned empty output");
    }

    return result;
  } catch (error) {
    throw new VideoValidationError(
      `Failed to transcode video: ${error instanceof Error ? error.message : "unknown error"}`,
      "body",
    );
  }
}
