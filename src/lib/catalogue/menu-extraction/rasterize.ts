import type { MenuExtractionPageMimeType } from "@/lib/catalogue/menu-extraction/page-media";
import { prepareImportedImageBytes } from "@/lib/media/imported-image";
import { MediaValidationError } from "@/lib/media/validation";
import { MENU_EXTRACTION_LIMITS } from "@/lib/catalogue/menu-extraction/config";

export type RasterizedMenuPage = {
  pageNumber: number;
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: MenuExtractionPageMimeType;
};

export type RasterizedMenuUpload = {
  pages: RasterizedMenuPage[];
};

export class MenuExtractionRasterizeError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "MenuExtractionRasterizeError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export type RasterizeMenuUploadOptions = {
  maxPixelDimension: number;
  maxUploadBytes: number;
  maxPages: number;
  renderTimeoutMs?: number;
  perPageRenderTimeoutMs?: number;
};

const DEFAULT_RENDER_TIMEOUT_MS = 120_000;
const DEFAULT_PER_PAGE_RENDER_TIMEOUT_MS = 45_000;
const MAX_RGBA_BYTES = 64 * 1024 * 1024;

export async function rasterizeMenuUpload(
  bytes: Buffer,
  mimeType: string,
  options: RasterizeMenuUploadOptions,
): Promise<RasterizedMenuUpload> {
  if (mimeType === MENU_EXTRACTION_LIMITS.allowedPdfMimeType) {
    return rasterizePdf(bytes, options);
  }
  const prepared = await prepareImportedImageBytes(bytes, {
    maxPixelDimension: options.maxPixelDimension,
    maxUploadBytes: options.maxUploadBytes,
  });
  return {
    pages: [
      {
        pageNumber: 1,
        bytes: prepared.bytes,
        width: prepared.width,
        height: prepared.height,
        mimeType: prepared.contentType,
      },
    ],
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MenuExtractionRasterizeError(message, 408, "file"));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function computeRenderScale(
  viewportWidth: number,
  viewportHeight: number,
  maxPixelDimension: number,
): number {
  const longest = Math.max(viewportWidth, viewportHeight);
  if (longest <= 0) {
    throw new MenuExtractionRasterizeError("PDF page has invalid dimensions.", 400, "file");
  }
  const fitScale = Math.min(1, maxPixelDimension / longest);
  const scaledWidth = viewportWidth * fitScale;
  const scaledHeight = viewportHeight * fitScale;
  const rgbaBytes = Math.ceil(scaledWidth) * Math.ceil(scaledHeight) * 4;
  if (rgbaBytes > MAX_RGBA_BYTES) {
    const capScale = Math.sqrt(MAX_RGBA_BYTES / (viewportWidth * viewportHeight * 4));
    return Math.min(fitScale, capScale);
  }
  return fitScale;
}

async function rasterizePdf(
  bytes: Buffer,
  options: RasterizeMenuUploadOptions,
): Promise<RasterizedMenuUpload> {
  const renderTimeoutMs = options.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const perPageTimeoutMs = options.perPageRenderTimeoutMs ?? DEFAULT_PER_PAGE_RENDER_TIMEOUT_MS;

  return withTimeout(
    rasterizePdfInner(bytes, options, perPageTimeoutMs),
    renderTimeoutMs,
    "PDF rendering timed out.",
  );
}

async function rasterizePdfInner(
  bytes: Buffer,
  options: RasterizeMenuUploadOptions,
  perPageTimeoutMs: number,
): Promise<RasterizedMenuUpload> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    disableAutoFetch: true,
    maxImageSize: options.maxPixelDimension * options.maxPixelDimension,
  });

  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > options.maxPages) {
      throw new MenuExtractionRasterizeError(
        `Menu sources may contain at most ${options.maxPages} pages.`,
        413,
        "file",
      );
    }
    if (pdf.numPages === 0) {
      throw new MenuExtractionRasterizeError("No readable pages were found in the upload.", 400, "file");
    }

    const pages: RasterizedMenuPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await withTimeout(
        pdf.getPage(pageNumber),
        perPageTimeoutMs,
        `Rendering page ${pageNumber} timed out.`,
      );
      try {
        const viewport = page.getViewport({ scale: 1 });
        const scale = computeRenderScale(viewport.width, viewport.height, options.maxPixelDimension);
        const scaled = page.getViewport({ scale });
        const width = Math.ceil(scaled.width);
        const height = Math.ceil(scaled.height);
        if (width > options.maxPixelDimension || height > options.maxPixelDimension) {
          throw new MenuExtractionRasterizeError(
            "A PDF page exceeds the configured pixel dimension limit.",
            413,
            "file",
          );
        }
        const rgbaBytes = width * height * 4;
        if (rgbaBytes > MAX_RGBA_BYTES) {
          throw new MenuExtractionRasterizeError(
            "A PDF page is too large to render safely.",
            413,
            "file",
          );
        }

        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        await withTimeout(
          page
            .render({
              canvas: canvas as unknown as HTMLCanvasElement,
              canvasContext: context as unknown as CanvasRenderingContext2D,
              viewport: scaled,
            })
            .promise,
          perPageTimeoutMs,
          `Rendering page ${pageNumber} timed out.`,
        );
        const jpeg = canvas.toBuffer("image/jpeg");
        pages.push({
          pageNumber,
          bytes: jpeg,
          width,
          height,
          mimeType: "image/jpeg",
        });
      } finally {
        page.cleanup();
      }
    }

    return { pages };
  } finally {
    if (pdf) {
      await pdf.cleanup();
    }
    await loadingTask.destroy();
  }
}

export function mapRasterizeError(error: unknown): MenuExtractionRasterizeError | MediaValidationError {
  if (error instanceof MenuExtractionRasterizeError || error instanceof MediaValidationError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "Menu upload could not be processed.";
  return new MenuExtractionRasterizeError(message, 400, "file");
}
