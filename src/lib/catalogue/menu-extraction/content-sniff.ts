import { MENU_EXTRACTION_LIMITS } from "@/lib/catalogue/menu-extraction/config";

export function sniffMenuExtractionMimeType(bytes: Buffer): string | null {
  if (bytes.byteLength >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return MENU_EXTRACTION_LIMITS.allowedPdfMimeType;
  }
  if (bytes.byteLength >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  return null;
}

export function resolveMenuExtractionMimeType(
  fileName: string,
  declared: string | null,
  bytes: Buffer,
): string {
  const sniffed = sniffMenuExtractionMimeType(bytes);
  if (sniffed) {
    return sniffed;
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return declared?.split(";")[0]?.trim().toLowerCase() ?? "";
}
