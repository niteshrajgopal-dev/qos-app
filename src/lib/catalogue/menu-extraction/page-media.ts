export type MenuExtractionPageMimeType = "image/jpeg" | "image/png";

export function menuExtractionPageFileExtension(
  mimeType: MenuExtractionPageMimeType,
): "jpg" | "png" {
  return mimeType === "image/png" ? "png" : "jpg";
}

export function menuExtractionPageMimeFromStoragePath(
  storagePath: string,
): MenuExtractionPageMimeType {
  return storagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}
