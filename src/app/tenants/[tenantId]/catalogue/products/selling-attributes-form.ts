/* Form helpers for the QOS-214 selling attributes. Inputs are text so that
   blank (unknown) never collapses into 0 or false. Nothing here fills a
   default or derives one field from another. */

export type TriState = "unknown" | "yes" | "no";

export function triStateFromBoolean(value: boolean | null | undefined): TriState {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

export function booleanFromTriState(value: TriState): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

/** Blank is null (unknown); whole numbers >= 0 parse; anything else is invalid. */
export function parseOptionalWholeNumber(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : "invalid";
}

/** Blank is null; a positive decimal parses; anything else is invalid. */
export function parseOptionalPositiveNumber(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value > 0 ? value : "invalid";
}

export function optionalNumberText(value: number | null | undefined) {
  return value == null ? "" : String(value);
}
