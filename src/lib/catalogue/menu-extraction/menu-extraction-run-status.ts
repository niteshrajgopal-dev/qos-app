import type { MenuExtractionLocale } from "@/lib/catalogue/menu-extraction/menu-extraction-ui-copy";

export function menuExtractionRunStatusLabel(
  status: string,
  locale: MenuExtractionLocale,
): string {
  if (status === "completed") {
    return locale === "ar" ? "جاهز" : "ready";
  }
  return status;
}
