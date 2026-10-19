import type { StaffMediaGenerationView } from "@/lib/media/ai-photos/staff-media-provenance";
import type { StaffLocale } from "@/lib/staff/locale";
import { staffUiCopy } from "@/lib/staff/locale";

function formatGenerationTime(requestedAt: string | undefined, locale: "en" | "ar") {
  if (!requestedAt) {
    return null;
  }
  const date = new Date(requestedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(locale === "ar" ? "ar-AE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Compact provenance line for staff UI (model · time · requester). */
function formatRequesterLabel(
  generation: StaffMediaGenerationView,
  locale: StaffLocale,
): string | null {
  if (typeof generation.requestedByDisplayName === "string") {
    return generation.requestedByDisplayName;
  }
  if (typeof generation.requestedBySubject === "string") {
    return staffUiCopy(locale, "staffMemberLabel");
  }
  return null;
}

export function formatStaffMediaGenerationSummary(
  generation: StaffMediaGenerationView | null | undefined,
  locale: StaffLocale,
): string | null {
  if (!generation) {
    return null;
  }
  const model = typeof generation.model === "string" ? generation.model : null;
  const time = formatGenerationTime(
    typeof generation.requestedAt === "string" ? generation.requestedAt : undefined,
    locale,
  );
  const requester = formatRequesterLabel(generation, locale);
  const parts = [model, time, requester].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
