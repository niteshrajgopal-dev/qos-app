import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readVideoProcessingConfig } from "@/lib/media/video-config";

export class VideoValidationError extends Error {
  readonly field?: string;
  /** True when retrying the same bytes could succeed (timeout, crash, missing binary). */
  readonly transient: boolean;

  constructor(message: string, field?: string, options: { transient?: boolean } = {}) {
    super(message);
    this.name = "VideoValidationError";
    this.field = field;
    this.transient = options.transient ?? false;
  }
}

/**
 * A non-zero exit on the same input is deterministic; a timeout, a kill by
 * signal (e.g. OOM) or a spawn failure is not.
 */
class VideoToolError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "VideoToolError";
  }
}

function isTransientToolFailure(error: unknown): boolean {
  return error instanceof VideoToolError ? error.transient : true;
}

const PROBE_TIMEOUT_MS = 30_000;
const POSTER_TIMEOUT_MS = 30_000;

/**
 * Pipe `input` into a child process and collect stdout, killing it after
 * `timeoutMs`. Never leaves a timer or listener behind, and turns spawn
 * failures (e.g. ENOENT when ffmpeg is not installed) into rejections
 * instead of an unhandled 'error' event that would crash the worker.
 */
function runBoundedProcess(
  command: string,
  args: string[],
  input: Buffer | null,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(Buffer.concat(chunks));
      }
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new VideoToolError(`${command} timed out after ${timeoutMs}ms`, true));
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      // Keep only the tail; ffmpeg can be very chatty.
      stderr = (stderr + data.toString()).slice(-4_000);
    });
    // EPIPE when the process exits before reading all input.
    child.stdin.on("error", () => {});
    child.on("error", (error) => finish(new VideoToolError(error.message, true)));
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish(null);
      } else if (code === null) {
        finish(new VideoToolError(`${command} was killed by ${signal ?? "a signal"}`, true));
      } else {
        finish(
          new VideoToolError(`${command} exited with code ${code}: ${stderr.trim()}`, false),
        );
      }
    });

    if (input) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * ffmpeg/ffprobe must read MP4 from a seekable file: uploads whose moov atom
 * is at the end (common for phone recordings) cannot be probed from a pipe,
 * and the mp4 muxer cannot write +faststart output to a pipe.
 */
async function withVideoFile<T>(
  bytes: Buffer,
  fn: (inputPath: string, workDir: string) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), "qos-video-"));
  try {
    const inputPath = path.join(workDir, "input.mp4");
    await writeFile(inputPath, bytes);
    return await fn(inputPath, workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Fail fast at worker boot when ffmpeg/ffprobe are missing from the image,
 * rather than failing (and retrying) every job.
 */
export async function assertVideoToolchainAvailable(): Promise<{
  ffmpeg: string;
  ffprobe: string;
}> {
  const versions: Record<"ffmpeg" | "ffprobe", string> = {
    ffmpeg: "",
    ffprobe: "",
  };

  for (const tool of ["ffmpeg", "ffprobe"] as const) {
    try {
      const output = await runBoundedProcess(tool, ["-version"], null, 10_000);
      versions[tool] = output.toString().split("\n")[0]?.trim() ?? tool;
    } catch (error) {
      throw new Error(
        `${tool} is required for video processing but is not runnable: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  return versions;
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
    const output = await withVideoFile(bytes, (inputPath) =>
      runBoundedProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration,format_name,bit_rate",
          "-show_entries",
          "stream=codec_name,codec_type,width,height",
          "-of",
          "json",
          "-i",
          inputPath,
        ],
        null,
        PROBE_TIMEOUT_MS,
      ),
    );
    probeResult = output.toString();
  } catch (error) {
    throw new VideoValidationError(
      `Failed to probe video metadata: ${error instanceof Error ? error.message : "unknown error"}`,
      "body",
      { transient: isTransientToolFailure(error) },
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
    const result = await withVideoFile(videoBytes, (inputPath) =>
      runBoundedProcess(
        "ffmpeg",
        [
          "-nostdin",
          "-ss",
          timestamp.toString(),
          "-i",
          inputPath,
          "-frames:v",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "-",
        ],
        null,
        POSTER_TIMEOUT_MS,
      ),
    );

    if (!result || result.length === 0) {
      throw new VideoToolError("ffmpeg returned empty output", false);
    }

    return result;
  } catch (error) {
    throw new VideoValidationError(
      `Failed to extract poster frame: ${error instanceof Error ? error.message : "unknown error"}`,
      "body",
      { transient: isTransientToolFailure(error) },
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
    const result = await withVideoFile(videoBytes, async (inputPath, workDir) => {
      const outputPath = path.join(workDir, `output.${config.transcodeTargetContainer}`);
      await runBoundedProcess(
        "ffmpeg",
        [
          "-nostdin",
          "-y",
          "-i",
          inputPath,
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
          outputPath,
        ],
        null,
        config.jobTimeoutMs,
      );
      return readFile(outputPath);
    });

    if (!result || result.length === 0) {
      throw new VideoToolError("ffmpeg returned empty output", false);
    }

    return result;
  } catch (error) {
    throw new VideoValidationError(
      `Failed to transcode video: ${error instanceof Error ? error.message : "unknown error"}`,
      "body",
      { transient: isTransientToolFailure(error) },
    );
  }
}
