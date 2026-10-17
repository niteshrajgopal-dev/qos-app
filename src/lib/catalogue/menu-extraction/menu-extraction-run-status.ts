import type { MenuExtractionLocale } from "@/lib/catalogue/menu-extraction/menu-extraction-ui-copy";

export function menuExtractionRunStatusLabel(
  status: string,
  locale: MenuExtractionLocale,
  decision: "confirmed" | "rejected" | "cancelled" | null = null,
): string {
  if (decision === "rejected" || decision === "cancelled") {
    return locale === "ar" ? "ملغى" : "cancelled";
  }
  if (decision === "confirmed") {
    return locale === "ar" ? "مؤكد" : "confirmed";
  }
  if (status === "completed") {
    return locale === "ar" ? "جاهز" : "ready";
  }
  return status;
}

export function isMenuExtractionReviewClosed(
  decision: "confirmed" | "rejected" | "cancelled" | null,
): boolean {
  return decision === "confirmed" || decision === "rejected" || decision === "cancelled";
}
