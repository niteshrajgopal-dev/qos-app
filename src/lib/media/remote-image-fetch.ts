import { readMediaConfig } from "@/lib/media/config";
import {
  detectImageContentType,
  MediaValidationError,
  validateImageBytes,
} from "@/lib/media/validation";

export const REMOTE_IMAGE_FETCH_DEFAULTS = {
  timeoutMs: 15_000,
} as const;

const PRIVATE_IPV4_PATTERN =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

export class RemoteImageFetchError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "RemoteImageFetchError";
    this.field = field;
  }
}

export function assertAllowedRemoteImageUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RemoteImageFetchError("Remote image URL is invalid.", "imageUrl");
  }

  if (parsed.protocol !== "https:") {
    throw new RemoteImageFetchError(
      "Remote image URL must use https.",
      "imageUrl",
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new RemoteImageFetchError(
      "Remote image URL host is not allowed.",
      "imageUrl",
    );
  }

  if (PRIVATE_IPV4_PATTERN.test(hostname)) {
    throw new RemoteImageFetchError(
      "Remote image URL host is not allowed.",
      "imageUrl",
    );
  }

  return parsed.toString();
}

export type RemoteImageFetchResult = {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
};

export type RemoteImageFetchDeps = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

export async function fetchRemoteImageBytes(
  url: string,
  deps: RemoteImageFetchDeps = {},
): Promise<RemoteImageFetchResult> {
  const config = readMediaConfig();
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? REMOTE_IMAGE_FETCH_DEFAULTS.timeoutMs;
  const maxBytes = deps.maxBytes ?? config.maxUploadBytes;
  const normalizedUrl = assertAllowedRemoteImageUrl(url);

  const response = await fetchImpl(normalizedUrl, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "image/jpeg,image/png,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new RemoteImageFetchError(
      `Remote image fetch failed with HTTP ${response.status}.`,
      "imageUrl",
    );
  }

  const contentLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isInteger(contentLength) && contentLength > maxBytes) {
    throw new RemoteImageFetchError(
      "Remote image exceeds the configured byte limit.",
      "imageUrl",
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  if (bytes.byteLength === 0) {
    throw new RemoteImageFetchError("Remote image is empty.", "imageUrl");
  }

  if (bytes.byteLength > maxBytes) {
    throw new RemoteImageFetchError(
      "Remote image exceeds the configured byte limit.",
      "imageUrl",
    );
  }

  const detectedContentType = detectImageContentType(bytes);
  if (
    detectedContentType !== "image/jpeg" &&
    detectedContentType !== "image/png"
  ) {
    throw new RemoteImageFetchError(
      "Remote image must be JPEG or PNG.",
      "contentType",
    );
  }

  try {
    await validateImageBytes(bytes, detectedContentType);
  } catch (error) {
    if (error instanceof MediaValidationError) {
      throw new RemoteImageFetchError(error.message, error.field);
    }

    throw error;
  }

  return {
    bytes,
    contentType: detectedContentType,
  };
}
