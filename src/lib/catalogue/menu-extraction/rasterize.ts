import { prepareImportedImageBytes } from "@/lib/media/imported-image";
import { MENU_EXTRACTION_LIMITS } from "@/lib/catalogue/menu-extraction/config";

export type RasterizedMenuPage = {
  pageNumber: number;
  bytes: Buffer;
  width: number;
  height: number;
};

export type RasterizedMenuUpload = {
  pages: RasterizedMenuPage[];
};

export async function rasterizeMenuUpload(
  bytes: Buffer,
  mimeType: string,
  options: { maxPixelDimension: number; maxUploadBytes: number },
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
      },
    ],
  };
}

async function rasterizePdf(
  bytes: Buffer,
  options: { maxPixelDimension: number },
): Promise<RasterizedMenuUpload> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pages: RasterizedMenuPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      1,
      options.maxPixelDimension / Math.max(viewport.width, viewport.height),
    );
    const scaled = page.getViewport({ scale: Math.max(scale, 0.25) });
    const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: scaled,
    }).promise;
    const png = canvas.toBuffer("image/jpeg");
    pages.push({
      pageNumber,
      bytes: png,
      width: Math.ceil(scaled.width),
      height: Math.ceil(scaled.height),
    });
  }

  return { pages };
}
