import { buildFineDineImageFetchCandidates } from "@/lib/catalogue/finedine-menu-extract";
import { prepareImportedImageBytes } from "@/lib/media/imported-image";
import { readMediaConfig } from "@/lib/media/config";
import { detectImageContentType, MediaValidationError } from "@/lib/media/validation";

export const REMOTE_IMAGE_FETCH_DEFAULTS = {
  timeoutMs: 15_000,
} as const;

const PRIVATE_IPV4_PATTERN =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

export class RemoteImageFetchError extends Error {
  readonly field?: string;
  readonly statusCode?: number;
  readonly code?: string;
  readonly sourceUrl?: string;

  constructor(
    message: string,
    field?: string,
    details?: {
      statusCode?: number;
      code?: string;
      sourceUrl?: string;
    },
  ) {
    super(message);
    this.name = "RemoteImageFetchError";
    this.field = field;
    this.statusCode = details?.statusCode;
    this.code = details?.code;
    this.sourceUrl = details?.sourceUrl;
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

function buildRemoteImageFetchCandidates(url: string) {
  const candidates = buildFineDineImageFetchCandidates(url);
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    unique.push(candidate);
  }

  return unique;
}

async function readErrorPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    return { code: undefined, message: undefined };
  }

  try {
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    return {
      code: typeof payload.code === "string" ? payload.code : undefined,
      message:
        typeof payload.message === "string" ? payload.message : undefined,
    };
  } catch {
    return { code: undefined, message: undefined };
  }
}

function isImageTooLargeError(
  status: number,
  code: string | undefined,
) {
  return status === 413 || code === "TooLargeImageException";
}

async function fetchRemoteImageCandidate(
  url: string,
  sourceUrl: string,
  deps: {
    fetchImpl: typeof fetch;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<RemoteImageFetchResult> {
  const normalizedUrl = assertAllowedRemoteImageUrl(url);
  const response = await deps.fetchImpl(normalizedUrl, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(deps.timeoutMs),
    headers: {
      accept: "image/jpeg,image/png,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    if (isImageTooLargeError(response.status, payload.code)) {
      throw new RemoteImageFetchError(
        `FineDine image is too large to return (HTTP 413 ${payload.code ?? "TooLargeImageException"}).`,
        "imageUrl",
        {
          statusCode: 413,
          code: payload.code ?? "TooLargeImageException",
          sourceUrl,
        },
      );
    }

    throw new RemoteImageFetchError(
      `Remote image fetch failed with HTTP ${response.status}.`,
      "imageUrl",
      {
        statusCode: response.status,
        code: payload.code,
        sourceUrl,
      },
    );
  }

  const contentLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isInteger(contentLength) && contentLength > deps.maxBytes) {
    throw new RemoteImageFetchError(
      "Remote image exceeds the configured byte limit.",
      "imageUrl",
      { sourceUrl },
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  if (bytes.byteLength === 0) {
    throw new RemoteImageFetchError("Remote image is empty.", "imageUrl", {
      sourceUrl,
    });
  }

  if (bytes.byteLength > deps.maxBytes) {
    throw new RemoteImageFetchError(
      "Remote image exceeds the configured byte limit.",
      "imageUrl",
      { sourceUrl },
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
      { sourceUrl },
    );
  }

  try {
    const prepared = await prepareImportedImageBytes(bytes, {
      maxUploadBytes: deps.maxBytes,
    });
    return {
      bytes: prepared.bytes,
      contentType: prepared.contentType,
    };
  } catch (error) {
    if (error instanceof MediaValidationError) {
      throw new RemoteImageFetchError(error.message, error.field, {
        sourceUrl,
      });
    }

    throw error;
  }
}

export async function fetchRemoteImageBytes(
  url: string,
  deps: RemoteImageFetchDeps = {},
): Promise<RemoteImageFetchResult> {
  const config = readMediaConfig();
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? REMOTE_IMAGE_FETCH_DEFAULTS.timeoutMs;
  const maxBytes = deps.maxBytes ?? config.maxUploadBytes;
  const sourceUrl = assertAllowedRemoteImageUrl(url);
  const candidates = buildRemoteImageFetchCandidates(sourceUrl);

  let lastTooLargeError: RemoteImageFetchError | null = null;

  for (const candidate of candidates) {
    try {
      return await fetchRemoteImageCandidate(candidate, sourceUrl, {
        fetchImpl,
        timeoutMs,
        maxBytes,
      });
    } catch (error) {
      if (
        error instanceof RemoteImageFetchError &&
        isImageTooLargeError(error.statusCode ?? 0, error.code)
      ) {
        lastTooLargeError = error;
        continue;
      }

      throw error;
    }
  }

  if (lastTooLargeError) {
    throw lastTooLargeError;
  }

  throw new RemoteImageFetchError(
    "Remote image fetch failed.",
    "imageUrl",
    { sourceUrl },
  );
}
