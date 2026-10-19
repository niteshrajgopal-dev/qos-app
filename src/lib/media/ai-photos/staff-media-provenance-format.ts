import type { StaffMediaGenerationView } from "@/lib/media/ai-photos/staff-media-provenance";

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
export function formatStaffMediaGenerationSummary(
  generation: StaffMediaGenerationView | null | undefined,
  locale: "en" | "ar",
): string | null {
  if (!generation) {
    return null;
  }
  const model = typeof generation.model === "string" ? generation.model : null;
  const time = formatGenerationTime(
    typeof generation.requestedAt === "string" ? generation.requestedAt : undefined,
    locale,
  );
  const requester =
    typeof generation.requestedBySubject === "string" ? generation.requestedBySubject : null;
  const parts = [model, time, requester].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
