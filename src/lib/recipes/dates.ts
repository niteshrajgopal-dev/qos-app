/* QOS-198 business-date helpers. Pure. Recipe versions, sellable links and
   item conversion rules all use half-open ranges: a row is live on date d
   when effective_from <= d and (effective_to is null or d < effective_to).
   Dates are ISO calendar strings (YYYY-MM-DD), so string order is date order. */

export function isLiveOn(effectiveFrom: string | null, effectiveTo: string | null, date: string): boolean {
  return effectiveFrom !== null && effectiveFrom <= date && (effectiveTo === null || date < effectiveTo);
}

/** True when the range has not ended by `date`: live now or starting later. */
export function isOpenOn(effectiveTo: string | null, date: string): boolean {
  return effectiveTo === null || date < effectiveTo;
}

export type VersionPhase = "draft" | "discarded" | "current" | "scheduled" | "ended";

/** Where a version stands on `today`. Only approved versions are ever current, scheduled or ended. */
export function versionPhase(
  version: { status: "draft" | "approved" | "discarded"; effectiveFrom: string | null; effectiveTo: string | null },
  today: string,
): VersionPhase {
  if (version.status !== "approved") {
    return version.status;
  }
  if (version.effectiveFrom !== null && version.effectiveFrom > today) {
    return "scheduled";
  }
  return isOpenOn(version.effectiveTo, today) ? "current" : "ended";
}

/** The calendar day before `date` (for "covers D0 to D-1" wording). */
export function previousDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
